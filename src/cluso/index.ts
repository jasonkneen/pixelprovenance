import { DEFAULT_PATTERN_SIZE, PATTERN_VERSION, type ComponentDescriptor, type SourceLocation } from '../pattern.js'
import { buildIdentityIndex, descriptorFor, OWNED_SELECTOR } from '../dropin/identity.js'
import { locateCrop } from '../dropin/locate.js'
import { analyzeScreenshot, type ScreenshotMatch } from '../demo-analysis.js'
import { defaultCaptureRoot, pageBox, sliceCanvas } from '../dropin/capture.js'
import { applySignals } from '../dropin/signal.js'

/**
 * cluso-inspector plugin: PixelProvenance identity for every comment.
 *
 * - Paints `[data-pp]` carriers while the inspector is enabled (Settings toggle);
 *   a toolbar chip shows how many elements are tagged.
 * - Hover label and comment popover show each element's path and source.
 * - Camera captures (element or drawn frame) are decoded from their pixels and
 *   the comment notes which element the image shows.
 * - Paste or drop a screenshot onto the page to find its element and comment on it.
 * - Adds `pixelprovenance` { path, type, source } to each comment target, and
 *   fills `target.source` from `data-pp-source` when the framework gave none.
 * - Names the tagged subject of region comments from layout geometry.
 * - Attaches the live codebook to sent payloads so an agent can decode any
 *   screenshot of the page (`pixelprovenance-decode --registry`).
 */

export interface ClusoPluginOptions {
  /** First path segment. Default: `data-pp-page` on <html>/<body>, else "page". */
  pageId?: string
  /** Paint carriers while the inspector is enabled. Default true. */
  signals?: boolean
  intensity?: number
  patternSize?: number
  /** Include the codebook in sent payloads. Default true. */
  registry?: boolean
}

export interface PixelProvenanceTarget {
  path: string
  type: string
  depth: number
  selector: string
  source?: SourceLocation
  /** True when the commented element itself is tagged (not an ancestor). */
  exact: boolean
}

interface ClusoTarget {
  source?: { file?: string; line?: number; column?: number; framework?: string; component?: string }
  annotations?: Array<{ label: string; value: string }>
  pixelprovenance?: PixelProvenanceTarget
}

interface ClusoComment {
  type?: string
  region?: { x: number; y: number; w: number; h: number; pageX?: number; pageY?: number } | null
  targets?: ClusoTarget[]
  screenshot?: { element?: string; clean?: string; viewport?: string } | null
  note?: string
  annotations?: Array<{ label: string; value: string }>
  pixelprovenance?: Record<string, unknown>
}

interface ScreenshotInput {
  rect: { x: number; y: number; w: number; h: number }
  crop: { x: number; y: number; w: number; h: number }
}

interface ClusoSetting {
  readonly value: boolean
  set: (value: boolean) => void
  setHint?: (text: string) => void
}

interface ClusoContext {
  inspector: { enabled: boolean; opts?: { screenshots?: unknown } } | null
  options: ClusoPluginOptions
  on?: (event: string, handler: (data: unknown) => void) => () => void
  toast?: (message: string) => void
  addSetting?: (spec: { key: string; label: string; hint?: string; value?: boolean; onChange?: (value: boolean) => void }) => ClusoSetting
  addIndicator?: (spec: { title: string }) => { set: (text: string, state?: 'ok' | 'warn' | '') => void }
  openComment?: (element: Element, extra?: { note?: string; screenshot?: string }) => void
}

export interface ClusoPlugin {
  name: 'pixelprovenance'
  /** Display name in the comment popover. */
  title: string
  setup: (ctx: ClusoContext) => () => void
  label: (element: Element, ctx: ClusoContext) => string | null
  describe: (target: ClusoTarget, element: Element, ctx: ClusoContext) => void
  screenshot: (input: ScreenshotInput, ctx: ClusoContext) => Promise<Record<string, unknown> | null>
  enrich: (comment: ClusoComment, elements: Element[], ctx: ClusoContext) => Promise<void>
  payload: (payload: Record<string, unknown>, ctx: ClusoContext) => Record<string, unknown>
}

const MAX_PAYLOAD_REGISTRY = 512

function pageIdFor(options: ClusoPluginOptions): string {
  return options.pageId ??
    document.body?.getAttribute('data-pp-page') ??
    document.documentElement.getAttribute('data-pp-page') ??
    'page'
}

function describeTagged(element: Element, pageId: string): PixelProvenanceTarget | null {
  if (element.closest(OWNED_SELECTOR)) return null
  const tagged = element.closest('[data-pp]')
  if (!(tagged instanceof HTMLElement)) return null
  const identity = buildIdentityIndex(document, pageId).identify(tagged)
  return { ...identity, exact: tagged === element }
}

function sourceLabel(source?: SourceLocation): string {
  return source ? ` (${source.file}:${source.line}:${source.column})` : ''
}

/** v2 threshold: true matches ≥ ~0.6, unrelated tags ≤ ~0.4. */
const MATCH_THRESHOLD = 0.5

/** Pixels of an image, optionally only a sub-rectangle given in image pixels. */
async function imagePixels(
  dataUrl: string,
  region?: { x: number; y: number; w: number; h: number },
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  const x = Math.max(0, Math.round(region?.x ?? 0))
  const y = Math.max(0, Math.round(region?.y ?? 0))
  const width = Math.max(1, Math.min(image.naturalWidth - x, Math.round(region?.w ?? image.naturalWidth)))
  const height = Math.max(1, Math.min(image.naturalHeight - y, Math.round(region?.h ?? image.naturalHeight)))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas unavailable')
  context.drawImage(image, x, y, width, height, 0, 0, width, height)
  return { data: context.getImageData(0, 0, width, height).data, width, height }
}

export interface PixelDecode {
  path: string | null
  score: number
  source?: SourceLocation
  element?: HTMLElement
  /** Every tag's score, best first (for checking a specific expected tag). */
  scores: Array<{ path: string; score: number }>
  error?: string
}

/** Decode an image against the page's live tags. */
export async function decodeImage(
  dataUrl: string,
  pageId: string,
  patternSize = DEFAULT_PATTERN_SIZE,
  region?: { x: number; y: number; w: number; h: number },
): Promise<PixelDecode> {
  const index = buildIdentityIndex(document, pageId)
  const codebook = index.tagged.map((node) => descriptorFor(node, index.identify(node), patternSize))
  if (codebook.length === 0) return { path: null, score: 0, scores: [] }
  const pixels = await imagePixels(dataUrl, region)
  let matches: ScreenshotMatch[] = []
  try {
    // threshold 0 keeps every tag's score, so callers can check an expected one.
    matches = analyzeScreenshot(pixels.data, pixels.width, pixels.height, codebook, {
      scales: [1, 2],
      threshold: 0,
    })
  } catch (error) {
    return { path: null, score: 0, scores: [], error: error instanceof Error ? error.message : String(error) }
  }
  const ranked = matches
    .filter((match) => match.score >= MATCH_THRESHOLD)
  const scores = matches
    .map((match) => ({ path: match.component.path, score: Math.round(match.score * 1000) / 1000 }))
    .sort((first, second) => second.score - first.score)
  const best = ranked[0]
  if (!best) return { path: null, score: scores[0]?.score ?? 0, scores }
  const element = index.tagged.find((node) => index.identify(node).path === best.component.path)
  return { path: best.component.path, score: best.score, source: best.component.source, element, scores }
}

function short(path: string, pageId: string): string {
  return path.startsWith(`${pageId}/`) ? path.slice(pageId.length + 1) : path
}

export function pixelprovenancePlugin(defaults: ClusoPluginOptions = {}): ClusoPlugin {
  const settings = (ctx: ClusoContext): ClusoPluginOptions => ({ ...defaults, ...ctx.options })

  return {
    name: 'pixelprovenance',
    title: 'PixelProvenance',

    setup(ctx) {
      const options = settings(ctx)
      const pageId = pageIdFor(options)
      let stopSignals: (() => void) | null = null
      // PP follows the toolbar camera: screenshots on = carriers painted + captures checked.
      const cameraOn = () => Boolean(ctx.inspector?.opts?.screenshots ?? true)
      // Same switch as the toolbar camera, described in Settings.
      const setting = ctx.addSetting?.({
        key: 'enabled',
        label: 'PixelProvenance',
        hint: 'Links what you select, frame or screenshot back to the source file and line it came from, and checks that each screenshot shows the element you picked. The camera button in the toolbar turns this on and off too.',
        value: cameraOn(),
        onChange: (value) => (ctx.inspector as { setScreenshots?: (on: boolean) => void } | null)?.setScreenshots?.(value),
      })

      function sync() {
        if (setting && setting.value !== cameraOn()) setting.set(cameraOn())
        const show = options.signals !== false && cameraOn() && Boolean(ctx.inspector?.enabled)
        if (show && !stopSignals) {
          stopSignals = applySignals(document, pageId, {
            intensity: options.intensity ?? 0.06,
            patternSize: options.patternSize ?? DEFAULT_PATTERN_SIZE,
            debug: false,
          })
        } else if (!show && stopSignals) {
          stopSignals()
          stopSignals = null
        }
      }

      // Paste or drop a screenshot: find the element it shows and start a comment on it.
      async function fromImage(file: File) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })
        const result = await decodeImage(dataUrl, pageId, options.patternSize)
        if (!result.path || !result.element) {
          ctx.toast?.('No PixelProvenance element found in that image')
          return
        }
        ctx.openComment?.(result.element, {
          note: `From screenshot: ${short(result.path, pageId)}${sourceLabel(result.source)} · match ${result.score.toFixed(2)}`,
          screenshot: dataUrl,
        })
      }
      const imageFrom = (items: DataTransferItemList | undefined) =>
        [...(items ?? [])].find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile() ?? null
      const editable = (target: EventTarget | null) =>
        target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))
      const onPaste = (event: ClipboardEvent) => {
        if (!ctx.inspector?.enabled || !cameraOn() || editable(event.target)) return
        const file = imageFrom(event.clipboardData?.items)
        if (!file) return
        event.preventDefault()
        void fromImage(file)
      }
      const onDragOver = (event: DragEvent) => {
        if (ctx.inspector?.enabled && [...(event.dataTransfer?.items ?? [])].some((item) => item.type.startsWith('image/'))) {
          event.preventDefault()
        }
      }
      const onDrop = (event: DragEvent) => {
        if (!ctx.inspector?.enabled) return
        const file = imageFrom(event.dataTransfer?.items)
        if (!file) return
        event.preventDefault()
        void fromImage(file)
      }
      document.addEventListener('paste', onPaste)
      window.addEventListener('dragover', onDragOver)
      window.addEventListener('drop', onDrop)

      const offs = [ctx.on?.('enable', sync), ctx.on?.('disable', sync), ctx.on?.('screenshots', sync)]
      sync()

      return () => {
        offs.forEach((off) => off?.())
        document.removeEventListener('paste', onPaste)
        window.removeEventListener('dragover', onDragOver)
        window.removeEventListener('drop', onDrop)
        stopSignals?.()
        stopSignals = null
      }
    },

    label(element, ctx) {
      const pageId = pageIdFor(settings(ctx))
      const tagged = describeTagged(element, pageId)
      if (!tagged) return null
      const where = tagged.source ? ` · ${tagged.source.file.split('/').pop()}:${tagged.source.line}` : ''
      return `${tagged.exact ? '' : '↑ '}${short(tagged.path, pageId)}${where}`
    },

    describe(target, element, ctx) {
      const tagged = describeTagged(element, pageIdFor(settings(ctx)))
      if (!tagged) return
      target.pixelprovenance = tagged
      if (tagged.source && !target.source?.file) {
        target.source = {
          ...target.source,
          framework: target.source?.framework ?? 'pixelprovenance',
          component: target.source?.component ?? tagged.path,
          file: tagged.source.file,
          line: tagged.source.line,
          column: tagged.source.column,
        }
      }
      target.annotations = [
        ...(target.annotations ?? []),
        {
          label: tagged.exact ? 'pixelprovenance' : 'pixelprovenance (ancestor)',
          value: `${tagged.path}${sourceLabel(tagged.source)}`,
        },
      ]
    },

    // Camera button: capture with html-to-image (bundled; no CDN), cropped to the element or drawn frame.
    async screenshot(input) {
      const root = document.body ?? document.documentElement
      const canvas = await defaultCaptureRoot(root)
      const source = pageBox(root)
      const page = (box: { x: number; y: number; w: number; h: number }) => ({
        x: box.x + window.scrollX, y: box.y + window.scrollY, w: box.w, h: box.h,
      })
      const element = sliceCanvas(canvas, page(input.crop), source)
      const viewport = sliceCanvas(canvas, page({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }), source)
      return { element: element.image, viewport: viewport.image, crop: input.crop, scale: element.scale }
    },

    // Every captured comment: decode its image and say which element the pixels show.
    async enrich(comment, _elements, ctx) {
      const options = settings(ctx)
      const pageId = pageIdFor(options)
      const expected = comment.targets?.[0]?.pixelprovenance?.path ?? null
      let subject: string | null = expected
      if (comment.region) {
        const region = comment.region
        const candidates = locateCrop({
          x: region.pageX ?? region.x + window.scrollX,
          y: region.pageY ?? region.y + window.scrollY,
          w: region.w,
          h: region.h,
        }, buildIdentityIndex(document, pageId), { x: window.scrollX, y: window.scrollY })
          .map(({ element: _element, ...rest }) => rest)
        if (candidates.length) {
          const best = candidates[0].coverage >= 0.5 ? candidates[0] : null
          comment.pixelprovenance = { ...comment.pixelprovenance, subject: best, candidates }
          subject = best?.path ?? subject
        }
        // Every tagged element the frame touches, deepest first, with its source.
        const index = buildIdentityIndex(document, pageId)
        const box = { left: region.x, top: region.y, right: region.x + region.w, bottom: region.y + region.h }
        const inside = index.tagged
          .map((node) => ({ node, rect: node.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width && rect.height &&
            rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top)
          .map(({ node, rect }) => {
            const overlap = (Math.min(rect.right, box.right) - Math.max(rect.left, box.left)) *
              (Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top))
            return { identity: index.identify(node), shareInside: overlap / (rect.width * rect.height) }
          })
          .sort((first, second) => second.identity.depth - first.identity.depth || second.shareInside - first.shareInside)
        comment.pixelprovenance = {
          ...comment.pixelprovenance,
          elements: inside.map(({ identity, shareInside }) => ({
            path: identity.path,
            selector: identity.selector,
            ...(identity.source ? { source: identity.source } : {}),
            inside: Math.round(shareInside * 100) / 100,
          })),
        }
        // Show what is mostly inside the frame; if nothing is, the element the frame sits in.
        const shown = inside.filter((entry) => entry.shareInside >= 0.5)
        const listedEntries = shown.length ? shown : inside.slice().sort((a, b) => b.identity.depth - a.identity.depth).slice(0, 1)
        if (listedEntries.length) {
          const listed = listedEntries.slice(0, 6).map(({ identity }) =>
            `${short(identity.path, pageId)}${identity.source ? ` (${identity.source.file.split('/').pop()}:${identity.source.line})` : ''}`)
          comment.annotations = [
            ...(comment.annotations ?? []),
            { label: 'in frame', value: listed.join(', ') + (listedEntries.length > 6 ? ` +${listedEntries.length - 6} more` : '') },
          ]
        }
      }
      const shot = comment.screenshot as { element?: string; crop?: { x: number; y: number }; scale?: number } | null | undefined
      const image = (shot as { clean?: string } | null | undefined)?.clean ?? shot?.element
      if (!image || ctx.inspector?.opts?.screenshots === false) return
      // Decode only the selected element (or drawn frame) inside the padded capture.
      let region: { x: number; y: number; w: number; h: number } | undefined
      const box = comment.region ?? (_elements[0] ? (() => {
        const r = _elements[0].getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height }
      })() : null)
      if (box && shot?.crop) {
        const scale = shot.scale ?? 1
        region = { x: (box.x - shot.crop.x) * scale, y: (box.y - shot.crop.y) * scale, w: box.w * scale, h: box.h * scale }
      }
      const decoded = await decodeImage(image, pageId, options.patternSize, region)
      // The selected element's carrier is present in its own pixels: that is the confirmation.
      // Its parent's carrier sits underneath and may score similarly; that is not a disagreement.
      const expectedScore = subject ? decoded.scores.find((entry) => entry.path === subject)?.score ?? 0 : 0
      const agrees = subject ? expectedScore >= MATCH_THRESHOLD : null
      if (agrees && subject) {
        decoded.path = subject
        decoded.score = expectedScore
        const index = buildIdentityIndex(document, pageId)
        decoded.source = index.tagged.map((node) => index.identify(node)).find((identity) => identity.path === subject)?.source
      }
      comment.pixelprovenance = {
        ...comment.pixelprovenance,
        pixels: {
          path: decoded.path,
          score: Math.round(decoded.score * 1000) / 1000,
          source: decoded.source,
          agrees,
          scores: decoded.scores.slice(0, 5),
          ...(decoded.error ? { error: decoded.error } : {}),
        },
      }
      // Only surface a confirmation; a miss adds nothing (layout already names the element).
      const confirmed = agrees === true || (agrees === null && decoded.path)
      if (!confirmed || !decoded.path) return
      const text = `${short(decoded.path, pageId)} ✓`
      const target = comment.targets?.[0]
      if (target) {
        target.annotations = [...(target.annotations ?? []), { label: 'pixels', value: text }]
      } else {
        comment.annotations = [...(comment.annotations ?? []), { label: 'pixels', value: text }]
      }
    },

    payload(payload, ctx) {
      const options = settings(ctx)
      if (options.registry === false) return payload
      const pageId = pageIdFor(options)
      const index = buildIdentityIndex(document, pageId)
      const registry: ComponentDescriptor[] = index.tagged
        .slice(0, MAX_PAYLOAD_REGISTRY)
        .map((node) => ({
          ...descriptorFor(node, index.identify(node), options.patternSize ?? DEFAULT_PATTERN_SIZE),
          patternVersion: PATTERN_VERSION,
        }))
      return {
        ...payload,
        pixelprovenance: {
          pageId,
          patternVersion: PATTERN_VERSION,
          intensity: options.intensity ?? 0.06,
          patternSize: options.patternSize ?? DEFAULT_PATTERN_SIZE,
          registry,
        },
      }
    },
  }
}

interface ClusoGlobal {
  use: (plugin: ClusoPlugin, options?: ClusoPluginOptions) => unknown
}

declare global {
  interface Window {
    ClusoInspector?: ClusoGlobal
    ClusoInspectorPlugins?: Array<unknown>
  }
}

/** Register with cluso-inspector now, or queue until it loads. */
export function registerWithCluso(options: ClusoPluginOptions = {}): ClusoPlugin {
  const plugin = pixelprovenancePlugin(options)
  if (window.ClusoInspector?.use) {
    window.ClusoInspector.use(plugin, options)
  } else {
    ;(window.ClusoInspectorPlugins ??= []).push([plugin, options])
  }
  return plugin
}
