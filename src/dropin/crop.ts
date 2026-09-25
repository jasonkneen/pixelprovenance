import type { ScreenshotMatch } from '../demo-analysis.js'
import { pathDepth } from '../pattern.js'
import { createSelectionPackage } from './package.js'
import type { SelectionPackage, SelectionRect } from './types.js'

export const MIN_SELECTION_PX = 32

export function normalizeRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
): SelectionRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  }
}

export function snapRect(
  area: SelectionRect,
  bounds: { width: number; height: number },
): SelectionRect {
  const width = Math.min(Math.max(area.w, MIN_SELECTION_PX), bounds.width)
  const height = Math.min(Math.max(area.h, MIN_SELECTION_PX), bounds.height)
  const centerX = area.x + area.w / 2
  const centerY = area.y + area.h / 2
  const x = Math.max(0, Math.min(bounds.width - width, centerX - width / 2))
  const y = Math.max(0, Math.min(bounds.height - height, centerY - height / 2))
  return { x, y, w: width, h: height }
}

export function finishCrop(options: {
  pageId: string
  rect: SelectionRect
  image: string
  html: string
  selector: string
  matches: ScreenshotMatch[]
  threshold: number
}): SelectionPackage {
  const best = options.matches[0]
  if (best && best.score >= options.threshold) {
    return createSelectionPackage({
      pageId: options.pageId,
      path: best.component.path,
      type: best.component.type,
      depth: best.component.depth,
      selector: options.selector,
      rect: options.rect,
      html: options.html,
      image: options.image,
      source: best.component.source,
      score: best.score,
    })
  }
  const path = `${options.pageId}/crop`
  return createSelectionPackage({
    pageId: options.pageId,
    path,
    type: 'crop',
    depth: pathDepth(path),
    selector: options.selector,
    rect: options.rect,
    html: options.html,
    image: options.image,
  })
}

export function startCrop(options: {
  onComplete: (rect: SelectionRect) => void
  onCancel?: () => void
}): () => void {
  const overlay = document.createElement('div')
  overlay.setAttribute('data-pp-toolbar', '')
  overlay.setAttribute('data-pp-crop-layer', '')
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483000',
    'cursor:crosshair',
    'background:rgba(23,25,39,0.08)',
  ].join(';')
  const box = document.createElement('div')
  box.style.cssText = [
    'position:absolute',
    'border:1px solid #5265ff',
    'background:rgba(82,101,255,0.12)',
    'pointer-events:none',
    'display:none',
  ].join(';')
  overlay.append(box)
  document.documentElement.append(overlay)

  let origin: { x: number; y: number } | null = null

  function point(event: PointerEvent) {
    return { x: event.clientX, y: event.clientY }
  }

  function renderBox(area: SelectionRect) {
    box.style.display = 'block'
    box.style.left = `${area.x}px`
    box.style.top = `${area.y}px`
    box.style.width = `${area.w}px`
    box.style.height = `${area.h}px`
  }

  function onDown(event: PointerEvent) {
    origin = point(event)
    overlay.setPointerCapture(event.pointerId)
    renderBox({ x: origin.x, y: origin.y, w: 0, h: 0 })
  }

  function onMove(event: PointerEvent) {
    if (!origin) return
    renderBox(normalizeRect(origin, point(event)))
  }

  function onUp(event: PointerEvent) {
    if (!origin) return
    const bounds = { width: window.innerWidth, height: window.innerHeight }
    const area = snapRect(normalizeRect(origin, point(event)), bounds)
    origin = null
    stop()
    options.onComplete({
      x: area.x + window.scrollX,
      y: area.y + window.scrollY,
      w: area.w,
      h: area.h,
    })
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    stop()
    options.onCancel?.()
  }

  function stop() {
    overlay.removeEventListener('pointerdown', onDown)
    overlay.removeEventListener('pointermove', onMove)
    overlay.removeEventListener('pointerup', onUp)
    window.removeEventListener('keydown', onKey)
    overlay.remove()
  }

  overlay.addEventListener('pointerdown', onDown)
  overlay.addEventListener('pointermove', onMove)
  overlay.addEventListener('pointerup', onUp)
  window.addEventListener('keydown', onKey)
  return stop
}
