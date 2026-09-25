import { toCanvas, toPng } from 'html-to-image'

import type { SelectionRect } from './types.js'

// Never capture our own toolbar or a host inspector's UI (cluso-inspector).
function isToolbarNode(node: Node): boolean {
  return node instanceof HTMLElement && Boolean(node.closest('[data-pp-toolbar], [data-ci-host]'))
}

/** Device pixels, capped so a full-page capture stays within canvas limits. */
export function capturePixelRatio(): number {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return Math.min(2, Math.max(1, ratio))
}

export async function defaultCaptureElement(element: HTMLElement): Promise<string> {
  return toPng(element, {
    pixelRatio: capturePixelRatio(),
    cacheBust: true,
    filter: (node) => !isToolbarNode(node),
  })
}

export async function defaultCaptureRoot(root: HTMLElement): Promise<HTMLCanvasElement> {
  return toCanvas(root, {
    pixelRatio: capturePixelRatio(),
    cacheBust: true,
    skipFonts: true,
    filter: (node) => !isToolbarNode(node),
  })
}

/** Page-coordinate box of the element the canvas was rendered from. */
export function pageBox(element: HTMLElement): { x: number; y: number; width: number; height: number } {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    width: rect.width || element.scrollWidth || window.innerWidth,
    height: rect.height || element.scrollHeight || window.innerHeight,
  }
}

/**
 * Cut a page-coordinate rect out of a canvas rendered from `source`.
 * `source` is where that element sits on the page (body margin, offsets), so
 * the crop lines up with what the user dragged; the scale follows the
 * canvas, so a 2× capture yields a 2× crop.
 */
export function sliceGeometry(
  canvas: { width: number; height: number },
  rect: SelectionRect,
  source: { x: number; y: number; width: number; height: number },
): { left: number; top: number; width: number; height: number; scale: number } {
  const scaleX = canvas.width / Math.max(1, source.width)
  const scaleY = canvas.height / Math.max(1, source.height)
  const left = Math.min(canvas.width - 1, Math.max(0, Math.round((rect.x - source.x) * scaleX)))
  const top = Math.min(canvas.height - 1, Math.max(0, Math.round((rect.y - source.y) * scaleY)))
  const width = Math.max(1, Math.min(canvas.width - left, Math.round(rect.w * scaleX)))
  const height = Math.max(1, Math.min(canvas.height - top, Math.round(rect.h * scaleY)))
  return { left, top, width, height, scale: (scaleX + scaleY) / 2 }
}

export function sliceCanvas(
  canvas: HTMLCanvasElement,
  rect: SelectionRect,
  source: { x: number; y: number; width: number; height: number },
): { image: string; data: Uint8ClampedArray; width: number; height: number; scale: number } {
  const { left, top, width, height, scale } = sliceGeometry(canvas, rect, source)
  const crop = document.createElement('canvas')
  crop.width = width
  crop.height = height
  const context = crop.getContext('2d')
  if (!context) {
    throw new Error('This browser could not prepare the selected crop.')
  }
  context.drawImage(canvas, left, top, width, height, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height)
  return {
    image: crop.toDataURL('image/png'),
    data: pixels.data,
    width,
    height,
    scale,
  }
}
