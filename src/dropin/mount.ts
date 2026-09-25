import { analyzeScreenshot } from '../demo-analysis.js'
import { DEFAULT_PATTERN_SIZE } from '../pattern.js'
import { defaultCaptureElement, defaultCaptureRoot, pageBox, sliceCanvas } from './capture.js'
import { finishCrop, startCrop } from './crop.js'
import { isDropinEnabled } from './enabled.js'
import { buildIdentityIndex, collectCodebook, cssSelectorFor, descriptorFor } from './identity.js'
import { locateCrop } from './locate.js'
import { createSelectionPackage } from './package.js'
import { startPicker } from './picker.js'
import { applySignals } from './signal.js'
import { removeToolbarStyles, renderToolbar, type ToolbarHandles } from './toolbar.js'
import { deliverPackage } from './transport.js'
import type { SelectionPackage, SelectionRect } from './types.js'

// v2 carriers: true matches ≥ ~0.6 even nested, unrelated tags ≤ ~0.4.
const MATCH_THRESHOLD = 0.5
const DEFAULT_INTENSITY = 0.06

export interface MountOptions {
  pageId: string
  endpoint?: string
  enabled?: boolean
  intensity?: number
  patternSize?: number
  debug?: boolean
  /**
   * Also decode the crop's pixels in-page and report whether they agree with
   * the DOM subject. Off by default: layout already names the element exactly,
   * and decoding costs a full-page render plus correlation.
   */
  verifyPixels?: boolean
  root?: ParentNode
  captureElement?: (element: HTMLElement) => Promise<string>
  captureRoot?: (root: HTMLElement) => Promise<HTMLCanvasElement>
  fetch?: typeof fetch
}

export interface PixelProvenanceApi {
  mount: typeof mount
  unmount: typeof unmount
  select: () => void
  crop: () => void
  cancel: () => void
  onPackage: typeof deliverPackage.subscribe
  exportRegistry: () => ReturnType<typeof collectCodebook>
}

interface Session {
  options: Required<Pick<MountOptions, 'pageId'>> & MountOptions
  toolbar: ToolbarHandles
  stopSignals: () => void
  stopMode?: () => void
}

let session: Session | null = null

function hostRoot(options: MountOptions): ParentNode {
  return options.root ?? document
}

function captureRootElement(): HTMLElement {
  return document.body ?? document.documentElement
}

async function packagePickedElement(element: HTMLElement, options: MountOptions): Promise<void> {
  const identity = buildIdentityIndex(hostRoot(options), options.pageId).identify(element)
  const rect = element.getBoundingClientRect()
  const capture = options.captureElement ?? defaultCaptureElement
  const image = await capture(element)
  const pkg = createSelectionPackage({
    ...identity,
    pageId: options.pageId,
    rect: {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      w: rect.width,
      h: rect.height,
    },
    html: element.outerHTML,
    image,
  })
  await emit(pkg, options)
}

async function packageCrop(rect: SelectionRect, options: MountOptions): Promise<void> {
  const index = buildIdentityIndex(hostRoot(options), options.pageId)
  const candidates = locateCrop(rect, index, { x: window.scrollX, y: window.scrollY })
  const root = captureRootElement()
  const capture = options.captureRoot ?? defaultCaptureRoot
  const canvas = await capture(root)
  const sliced = sliceCanvas(canvas, rect, pageBox(root))
  let matches: ReturnType<typeof analyzeScreenshot> | undefined
  if (options.verifyPixels || candidates.length === 0) {
    const codebook = index.tagged.map((node) =>
      descriptorFor(node, index.identify(node), options.patternSize ?? DEFAULT_PATTERN_SIZE))
    matches = codebook.length === 0
      ? []
      : analyzeScreenshot(sliced.data, sliced.width, sliced.height, codebook, {
        intensity: options.intensity ?? DEFAULT_INTENSITY,
        patternSize: options.patternSize ?? DEFAULT_PATTERN_SIZE,
        scales: [Math.min(2, Math.max(1, Math.round(sliced.scale)))],
        threshold: MATCH_THRESHOLD,
      })
  }
  const centerX = rect.x + rect.w / 2 - window.scrollX
  const centerY = rect.y + rect.h / 2 - window.scrollY
  const under = document.elementFromPoint(centerX, centerY)
  const target = under instanceof HTMLElement && !under.closest('[data-pp-toolbar]') ? under : root
  const pkg = finishCrop({
    pageId: options.pageId,
    rect,
    image: sliced.image,
    html: target.outerHTML,
    selector: cssSelectorFor(target),
    candidates,
    matches,
    threshold: MATCH_THRESHOLD,
  })
  await emit(pkg, options)
}

async function emit(pkg: SelectionPackage, options: MountOptions): Promise<void> {
  const result = await deliverPackage(pkg, {
    endpoint: options.endpoint,
    fetch: options.fetch,
  })
  if (!session) return
  session.toolbar.setStatus(result.ok ? pkg.path : (result.error ?? 'Send failed'))
}

function beginSelect(): void {
  if (!session) return
  session.stopMode?.()
  session.toolbar.setMode('select')
  session.toolbar.setStatus('Click an element')
  session.stopMode = startPicker({
    onPick: (element) => {
      void packagePickedElement(element, session!.options).finally(() => {
        idle()
      })
    },
    onCancel: idle,
  })
}

function beginCrop(): void {
  if (!session) return
  session.stopMode?.()
  session.toolbar.setMode('crop')
  session.toolbar.setStatus('Drag a rectangle')
  session.stopMode = startCrop({
    onComplete: (rect) => {
      void packageCrop(rect, session!.options).finally(() => {
        idle()
      })
    },
    onCancel: idle,
  })
}

function idle(): void {
  if (!session) return
  session.stopMode?.()
  session.stopMode = undefined
  session.toolbar.setMode('idle')
}

export function mount(options: MountOptions): PixelProvenanceApi {
  unmount()
  const enabled = options.enabled ?? isDropinEnabled({
    hostname: typeof location === 'undefined' ? '' : location.hostname,
    flag: undefined,
  })
  if (!enabled || typeof document === 'undefined') {
    // Still expose the API so a disabled page can mount on demand.
    if (typeof window !== 'undefined') window.PixelProvenance = getApi()
    return getApi()
  }

  const toolbar = renderToolbar({
    onSelect: beginSelect,
    onCrop: beginCrop,
    onCancel: idle,
  })
  const stopSignals = applySignals(hostRoot(options), options.pageId, {
    intensity: options.intensity ?? DEFAULT_INTENSITY,
    patternSize: options.patternSize ?? DEFAULT_PATTERN_SIZE,
    debug: options.debug ?? false,
  })
  session = { options, toolbar, stopSignals }
  const api = getApi()
  if (typeof window !== 'undefined') {
    window.PixelProvenance = api
  }
  return api
}

export function unmount(): void {
  if (!session) {
    removeToolbarStyles()
    return
  }
  session.stopMode?.()
  session.stopSignals()
  session.toolbar.root.remove()
  removeToolbarStyles()
  session = null
}

function getApi(): PixelProvenanceApi {
  return {
    mount,
    unmount,
    select: beginSelect,
    crop: beginCrop,
    cancel: idle,
    onPackage: deliverPackage.subscribe,
    exportRegistry: () => {
      if (!session) return []
      return collectCodebook(
        hostRoot(session.options),
        session.options.pageId,
        session.options.patternSize ?? DEFAULT_PATTERN_SIZE,
      )
    },
  }
}

export function configFromScript(script: HTMLScriptElement): MountOptions {
  return {
    pageId: script.dataset.ppPage ?? 'page',
    endpoint: script.dataset.ppEndpoint,
    enabled: isDropinEnabled({
      hostname: location.hostname,
      flag: script.dataset.ppEnabled,
    }),
    intensity: script.dataset.ppIntensity ? Number(script.dataset.ppIntensity) : undefined,
    patternSize: script.dataset.ppPatternSize ? Number(script.dataset.ppPatternSize) : undefined,
    debug: script.dataset.ppDebug === 'true',
    verifyPixels: script.dataset.ppVerifyPixels === 'true',
  }
}

export function autoMount(script?: HTMLScriptElement | null): void {
  if (typeof document === 'undefined') return
  const node = script
    ?? (document.currentScript instanceof HTMLScriptElement ? document.currentScript : null)
    ?? document.querySelector('script[data-pp-page]')
  if (!(node instanceof HTMLScriptElement)) return
  mount(configFromScript(node))
}

declare global {
  interface Window {
    PixelProvenance?: PixelProvenanceApi
  }
}
