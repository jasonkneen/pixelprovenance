import type { SourceLocation } from '../pattern.js'
import type { SelectionPackage, SelectionRect } from './types.js'

export const MAX_PACKAGE_HTML = 4000

export interface SelectionPackageInput {
  pageId: string
  path: string
  type: string
  depth: number
  selector: string
  rect: SelectionRect
  html: string
  image: string
  source?: SourceLocation
  score?: number
  capturedAt?: string
}

function truncateHtml(html: string): string {
  if (html.length <= MAX_PACKAGE_HTML) return html
  return html.slice(0, MAX_PACKAGE_HTML)
}

export function createSelectionPackage(input: SelectionPackageInput): SelectionPackage {
  const pkg: SelectionPackage = {
    version: 1,
    pageId: input.pageId,
    path: input.path,
    type: input.type,
    depth: input.depth,
    selector: input.selector,
    rect: input.rect,
    html: truncateHtml(input.html),
    image: input.image,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  }
  if (input.source) pkg.source = input.source
  if (typeof input.score === 'number' && Number.isFinite(input.score)) {
    pkg.score = input.score
  }
  return pkg
}
