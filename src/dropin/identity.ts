import type { ComponentDescriptor, SourceLocation } from '../pattern.js'

export interface ElementIdentity {
  path: string
  type: string
  depth: number
  selector: string
  source?: SourceLocation
}

const TOOLBAR_SELECTOR = '[data-pp-toolbar]'

export function parseSource(value: string | null | undefined): SourceLocation | undefined {
  if (!value) return undefined
  const match = value.match(/^(.*):(\d+):(\d+)$/)
  if (!match) return undefined
  const line = Number(match[2])
  const column = Number(match[3])
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column)) return undefined
  return { file: match[1], line, column }
}

function escapeSelectorValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function ownSegment(element: HTMLElement): string {
  return element.getAttribute('data-pp')
    ?? element.getAttribute('data-testid')
    ?? (element.id || element.tagName.toLowerCase())
}

function ancestorPpSegments(element: Element): string[] {
  const segments: string[] = []
  let current = element.parentElement
  while (current) {
    const value = current.getAttribute('data-pp')
    if (value) segments.unshift(value)
    current = current.parentElement
  }
  return segments
}

export function cssSelectorFor(element: HTMLElement): string {
  const pp = element.getAttribute('data-pp')
  if (pp) {
    const selector = `[data-pp="${escapeSelectorValue(pp)}"]`
    if (element.ownerDocument.querySelectorAll(selector).length === 1) return selector
  }
  const testid = element.getAttribute('data-testid')
  if (testid) {
    const selector = `[data-testid="${escapeSelectorValue(testid)}"]`
    if (element.ownerDocument.querySelectorAll(selector).length === 1) return selector
  }
  if (element.id) {
    const selector = `#${escapeSelectorValue(element.id)}`
    if (element.ownerDocument.querySelectorAll(selector).length === 1) return selector
  }
  return ownSegment(element)
}

export function resolveTarget(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof Element)) return null
  if (start.closest(TOOLBAR_SELECTOR)) return null
  const tagged = start.closest('[data-pp]')
  if (tagged instanceof HTMLElement) return tagged
  const testid = start.closest('[data-testid]')
  if (testid instanceof HTMLElement) return testid
  const withId = start.closest('[id]')
  if (withId instanceof HTMLElement && withId.id) return withId
  return start instanceof HTMLElement ? start : start.parentElement
}

export function resolveIdentity(element: HTMLElement, pageId: string): ElementIdentity {
  const path = [pageId, ...ancestorPpSegments(element), ownSegment(element)].join('/')
  const type = element.getAttribute('data-pp-type') ?? element.tagName.toLowerCase()
  const source = parseSource(element.getAttribute('data-pp-source'))
  return {
    path,
    type,
    depth: path.split('/').filter(Boolean).length,
    selector: cssSelectorFor(element),
    ...(source ? { source } : {}),
  }
}

export function collectCodebook(root: ParentNode, pageId: string): ComponentDescriptor[] {
  const nodes = [...root.querySelectorAll('[data-pp]')]
  const descriptors: ComponentDescriptor[] = []
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    if (node.closest(TOOLBAR_SELECTOR)) continue
    const identity = resolveIdentity(node, pageId)
    const patternSizeRaw = node.getAttribute('data-pp-pattern-size')
    const patternSize = patternSizeRaw ? Number(patternSizeRaw) : undefined
    descriptors.push({
      path: identity.path,
      type: identity.type,
      depth: identity.depth,
      ...(identity.source ? { source: identity.source } : {}),
      ...(patternSize && Number.isFinite(patternSize) ? { patternSize } : {}),
    })
  }
  return descriptors
}
