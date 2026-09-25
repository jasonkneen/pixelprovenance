import {
  clampIntensity,
  createPatternPayload,
  generatePatternRgba,
} from '../pattern.js'
import { buildIdentityIndex, tagPatternSize } from './identity.js'

const patternUrlCache = new Map<string, string>()
const MAX_CACHED_PATTERN_URLS = 256
// Catches layout moves no observer reports (CSS transitions, sticky, etc.).
const SAFETY_RECONCILE_MS = 1000
const WATCHED_ATTRIBUTES = [
  'data-pp',
  'data-pp-key',
  'data-pp-type',
  'data-pp-source',
  'data-pp-pattern-size',
  'class',
  'style',
  'hidden',
]

function createPatternDataUrl(
  payload: string,
  patternSize: number,
  intensity: number,
): string | null {
  const cacheKey = `${payload}\u0000${patternSize}\u0000${intensity}`
  const cached = patternUrlCache.get(cacheKey)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = patternSize
  canvas.height = patternSize
  const context = canvas.getContext('2d')
  if (!context) return null
  try {
    const imageData = context.createImageData(patternSize, patternSize)
    imageData.data.set(generatePatternRgba(payload, patternSize, intensity))
    context.putImageData(imageData, 0, 0)
    const dataUrl = canvas.toDataURL('image/png')
    if (patternUrlCache.size >= MAX_CACHED_PATTERN_URLS) {
      const oldestKey = patternUrlCache.keys().next().value
      if (oldestKey !== undefined) patternUrlCache.delete(oldestKey)
    }
    patternUrlCache.set(cacheKey, dataUrl)
    return dataUrl
  } catch {
    return null
  }
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

function intersect(first: Box, second: Box): Box {
  return {
    left: Math.max(first.left, second.left),
    top: Math.max(first.top, second.top),
    right: Math.min(first.right, second.right),
    bottom: Math.min(first.bottom, second.bottom),
  }
}

/** Viewport box of `element` after clipping by overflow-hidden ancestors. */
function visibleBox(
  element: HTMLElement,
  rect: DOMRect,
  clipCache: Map<Element, Box | null>,
): Box {
  let box: Box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    let clip = clipCache.get(parent)
    if (clip === undefined) {
      const style = getComputedStyle(parent)
      const clips = style.overflowX !== 'visible' || style.overflowY !== 'visible'
      const parentRect = parent.getBoundingClientRect()
      clip = clips
        ? { left: parentRect.left, top: parentRect.top, right: parentRect.right, bottom: parentRect.bottom }
        : null
      clipCache.set(parent, clip)
    }
    if (clip) box = intersect(box, clip)
    if (box.right <= box.left || box.bottom <= box.top) break
  }
  return box
}

export interface SignalOptions {
  intensity: number
  patternSize: number
  debug: boolean
}

/**
 * Paint each `[data-pp]` carrier into one overlay layer instead of the host
 * tree. Host elements are never restyled or given children, so void elements
 * (`img`, `input`) work, framework reconciliation is untouched, and absolute
 * descendants keep their containing block. Observers keep the layer in step
 * with added/removed tags, resizes and scrolling.
 */
export function applySignals(
  root: ParentNode,
  pageId: string,
  options: SignalOptions,
): () => void {
  const intensity = clampIntensity(options.intensity)
  const layer = document.createElement('div')
  layer.setAttribute('data-pp-signal-layer', '')
  layer.setAttribute('aria-hidden', 'true')
  layer.style.cssText = [
    'position:absolute',
    'left:0',
    'top:0',
    'width:0',
    'height:0',
    'overflow:visible',
    'pointer-events:none',
    'z-index:2147482000',
  ].join(';')
  ;(document.body ?? document.documentElement).append(layer)

  const tiles = new Map<HTMLElement, HTMLDivElement>()
  const resizeObserver = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(() => schedule())
  let frame = 0
  let stopped = false

  function reconcile(): void {
    frame = 0
    if (stopped) return
    const index = buildIdentityIndex(root, pageId)
    const live = new Set(index.tagged)
    for (const [element, tile] of tiles) {
      if (live.has(element)) continue
      tile.remove()
      tiles.delete(element)
      resizeObserver?.unobserve(element)
    }
    const origin = layer.getBoundingClientRect()
    // Snap to device pixels: a fractional offset makes capture tools resample the tile.
    const ratio = window.devicePixelRatio || 1
    const snap = (value: number) => Math.round(value * ratio) / ratio
    const clipCache = new Map<Element, Box | null>()
    for (const element of index.tagged) {
      let tile = tiles.get(element)
      if (!tile) {
        tile = document.createElement('div')
        tile.setAttribute('data-pixelprovenance-signal', '')
        tiles.set(element, tile)
        layer.append(tile)
        resizeObserver?.observe(element)
      }
      // A React DevTag already paints its own carrier child; do not double-paint.
      if (element.querySelector(':scope > [data-pixelprovenance-signal]')) {
        tile.style.display = 'none'
        continue
      }
      const identity = index.identify(element)
      const rect = element.getBoundingClientRect()
      const box = visibleBox(element, rect, clipCache)
      const hidden = rect.width === 0 || rect.height === 0 ||
        box.right <= box.left || box.bottom <= box.top ||
        getComputedStyle(element).visibility === 'hidden'
      if (hidden) {
        tile.style.display = 'none'
        continue
      }
      const patternSize = tagPatternSize(element, options.patternSize)
      const payload = createPatternPayload({
        path: identity.path,
        type: identity.type,
        depth: identity.depth,
        source: identity.source,
      })
      const url = createPatternDataUrl(payload, patternSize, intensity)
      tile.setAttribute('data-pixelprovenance-path', identity.path)
      tile.style.cssText = [
        'position:absolute',
        'display:block',
        `left:${snap(box.left - origin.left)}px`,
        `top:${snap(box.top - origin.top)}px`,
        `width:${snap(box.right - box.left)}px`,
        `height:${snap(box.bottom - box.top)}px`,
        `z-index:${identity.depth}`,
        options.debug ? 'outline:1px solid rgba(82, 101, 255, 0.85)' : '',
        url ? `background-image:url(${url})` : '',
        'background-repeat:repeat',
        // Anchor tiles to the element's own origin even when clipped.
        `background-position:${snap(rect.left - box.left)}px ${snap(rect.top - box.top)}px`,
        `background-size:${patternSize}px ${patternSize}px`,
      ].filter(Boolean).join(';')
    }
  }

  function schedule(): void {
    if (frame || stopped) return
    frame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(reconcile)
      : (setTimeout(reconcile, 16) as unknown as number)
  }

  const mutationObserver = new MutationObserver((records) => {
    if (records.every((record) => layer.contains(record.target))) return
    schedule()
  })
  mutationObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: WATCHED_ATTRIBUTES,
  })
  window.addEventListener('scroll', schedule, { capture: true, passive: true })
  window.addEventListener('resize', schedule)
  const safety = setInterval(schedule, SAFETY_RECONCILE_MS)

  reconcile()

  return () => {
    stopped = true
    if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    mutationObserver.disconnect()
    resizeObserver?.disconnect()
    window.removeEventListener('scroll', schedule, { capture: true })
    window.removeEventListener('resize', schedule)
    clearInterval(safety)
    layer.remove()
    tiles.clear()
  }
}
