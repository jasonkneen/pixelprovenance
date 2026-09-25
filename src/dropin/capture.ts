import { toCanvas, toPng } from 'html-to-image'
import type { SelectionRect } from './types.js'

function isToolbarNode(node: Node): boolean {
  return node instanceof HTMLElement && Boolean(node.closest('[data-pp-toolbar]'))
}

export async function defaultCaptureElement(element: HTMLElement): Promise<string> {
  return toPng(element, {
    pixelRatio: 1,
    cacheBust: true,
    filter: (node) => !isToolbarNode(node),
  })
}

export async function defaultCaptureRoot(root: HTMLElement): Promise<HTMLCanvasElement> {
  return toCanvas(root, {
    pixelRatio: 1,
    cacheBust: true,
    skipFonts: true,
    filter: (node) => !isToolbarNode(node),
  })
}

export function sliceCanvas(
  canvas: HTMLCanvasElement,
  rect: SelectionRect,
  sourceSize: { width: number; height: number },
): { image: string; data: Uint8ClampedArray; width: number; height: number } {
  const scaleX = canvas.width / Math.max(1, sourceSize.width)
  const scaleY = canvas.height / Math.max(1, sourceSize.height)
  const width = Math.max(1, Math.round(rect.w * scaleX))
  const height = Math.max(1, Math.round(rect.h * scaleY))
  const crop = document.createElement('canvas')
  crop.width = width
  crop.height = height
  const context = crop.getContext('2d')
  if (!context) {
    throw new Error('This browser could not prepare the selected crop.')
  }
  context.drawImage(
    canvas,
    Math.round(rect.x * scaleX),
    Math.round(rect.y * scaleY),
    width,
    height,
    0,
    0,
    width,
    height,
  )
  const pixels = context.getImageData(0, 0, width, height)
  return { image: crop.toDataURL('image/png'), data: pixels.data, width, height }
}
