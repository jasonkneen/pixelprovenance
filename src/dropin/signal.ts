import {
  clampIntensity,
  clampPatternSize,
  createPatternPayload,
  generatePatternRgba,
} from '../pattern.js'
import { resolveIdentity } from './identity.js'

const patternUrlCache = new Map<string, string>()
const MAX_CACHED_PATTERN_URLS = 128

function createPatternDataUrl(
  payload: string,
  patternSize: number,
  intensity: number,
): string | null {
  if (typeof document === 'undefined') return null
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

export function applySignals(
  root: ParentNode,
  pageId: string,
  options: { intensity: number; patternSize: number; debug: boolean },
): () => void {
  const intensity = clampIntensity(options.intensity)
  const owned: HTMLElement[] = []
  for (const node of root.querySelectorAll('[data-pp]')) {
    if (!(node instanceof HTMLElement)) continue
    if (node.closest('[data-pp-toolbar]')) continue
    if (node.querySelector(':scope > [data-pixelprovenance-signal]')) continue
    const identity = resolveIdentity(node, pageId)
    const patternSize = clampPatternSize(
      Number(node.getAttribute('data-pp-pattern-size')) || options.patternSize,
    )
    node.setAttribute('data-pixelprovenance-id', node.getAttribute('data-pp') ?? '')
    node.setAttribute('data-pixelprovenance-path', identity.path)
    node.setAttribute('data-pixelprovenance-type', identity.type)
    if (identity.source) {
      node.setAttribute(
        'data-pixelprovenance-source',
        `${identity.source.file}:${identity.source.line}:${identity.source.column}`,
      )
    }
    const computed = window.getComputedStyle(node)
    if (computed.position === 'static') {
      node.style.position = 'relative'
      node.setAttribute('data-pp-restore-position', 'static')
    }
    const payload = createPatternPayload({
      path: identity.path,
      type: identity.type,
      depth: identity.depth,
      source: identity.source,
    })
    const url = createPatternDataUrl(payload, patternSize, intensity)
    const signal = document.createElement('span')
    signal.setAttribute('aria-hidden', 'true')
    signal.setAttribute('data-pixelprovenance-signal', '')
    signal.setAttribute('data-pp-owned-signal', '')
    signal.style.cssText = [
      'position:absolute',
      'inset:0',
      `z-index:${20 + identity.depth}`,
      'pointer-events:none',
      options.debug ? 'border:1px solid rgba(82, 101, 255, 0.85)' : 'border:0',
      url ? `background-image:url(${url})` : '',
      'background-repeat:repeat',
      'background-position:0 0',
      `background-size:${patternSize}px ${patternSize}px`,
    ].filter(Boolean).join(';')
    node.append(signal)
    owned.push(node)
  }
  return () => {
    for (const node of owned) {
      node.querySelectorAll(':scope > [data-pp-owned-signal]').forEach((signal) => signal.remove())
      if (node.getAttribute('data-pp-restore-position') === 'static') {
        node.style.position = ''
        node.removeAttribute('data-pp-restore-position')
      }
    }
  }
}
