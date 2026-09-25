import type { SourceLocation } from '../pattern.js'

export interface SelectionRect {
  x: number
  y: number
  w: number
  h: number
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
  score?: number
  capturedAt: string
}

export interface DeliveryResult {
  ok: boolean
  error?: string
}
