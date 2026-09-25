import type { SourceLocation } from '../pattern.js'

export interface SelectionRect {
  x: number
  y: number
  w: number
  h: number
}

export interface CropCandidate {
  path: string
  type: string
  depth: number
  selector: string
  source?: SourceLocation
  /** Share of the crop covered by this element (0–1). */
  coverage: number
  /** Overlap over union with the crop (0–1). */
  iou: number
  /** Live element; stripped before delivery. */
  element?: HTMLElement
}

export interface PixelVerification {
  path: string | null
  score: number
  /** True when the pixel decode names the same path as the DOM subject. */
  agrees: boolean
}

export interface SelectionPackage {
  version: 1
  pageId: string
  path: string
  type: string
  depth: number
  selector: string
  rect: SelectionRect
  source?: SourceLocation
  html: string
  image: string
  /** Pixel-decode correlation, present only when pixels named the path. */
  score?: number
  /** How `path` was determined for a crop. Absent for Select. */
  method?: 'dom' | 'pixels' | 'none'
  /** Other tagged elements the crop overlaps, best first (crop only). */
  candidates?: Array<Omit<CropCandidate, 'element'>>
  /** Optional in-page pixel cross-check (crop with `verifyPixels`). */
  pixel?: PixelVerification
  capturedAt: string
}

export interface DeliveryResult {
  ok: boolean
  error?: string
}
