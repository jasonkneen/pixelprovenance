import {
  DEFAULT_PATTERN_SIZE,
  clampPatternSize,
  type ComponentDescriptor,
  type SourceLocation,
} from '../pattern.js'

export interface ElementIdentity {
  path: string
  type: string
  depth: number
  selector: string
  source?: SourceLocation
}

/** Layers the drop-in owns. They are never picked or tagged. */
export const OWNED_SELECTOR = '[data-pp-toolbar], [data-pp-signal-layer]'

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

function isOwned(element: Element): boolean {
  return Boolean(element.closest(OWNED_SELECTOR))
}

function baseSegment(element: Element): string {
  const name = element.getAttribute('data-pp')
    ?? element.getAttribute('data-testid')
    ?? (element.id || element.tagName.toLowerCase())
  const key = element.getAttribute('data-pp-key')
  return key ? `${name}[${key}]` : name
}

function nearestPpAncestor(element: Element): Element | null {
  let current = element.parentElement
  while (current) {
    if (current.hasAttribute('data-pp')) return current
    current = current.parentElement
  }
  return null
}

/**
 * Path segments for every live `[data-pp]` node. Siblings that share a name
 * under the same tagged parent get a document-order `[n]` suffix so list rows
 * receive distinct carriers; `data-pp-key` gives a stable suffix instead.
 */
function buildSegmentIndex(root: ParentNode): Map<Element, string> {
  const nodes = [...root.querySelectorAll('[data-pp]')].filter((node) => !isOwned(node))
  const groups = new Map<Element | null, Map<string, Element[]>>()
  for (const node of nodes) {
    const parent = nearestPpAncestor(node)
    const byName = groups.get(parent) ?? new Map<string, Element[]>()
    groups.set(parent, byName)
    const name = baseSegment(node)
    byName.set(name, [...(byName.get(name) ?? []), node])
  }
  const segments = new Map<Element, string>()
  for (const byName of groups.values()) {
    for (const [name, members] of byName) {
      members.forEach((member, index) => {
        segments.set(member, members.length > 1 ? `${name}[${index}]` : name)
      })
    }
  }
  return segments
}

export interface IdentityIndex {
  /** Identity for a tagged or fallback element under this index. */
  identify: (element: HTMLElement) => ElementIdentity
  /** Tagged elements in document order. */
  tagged: HTMLElement[]
}

export function buildIdentityIndex(root: ParentNode, pageId: string): IdentityIndex {
  const segments = buildSegmentIndex(root)
  const segmentOf = (element: Element) => segments.get(element) ?? baseSegment(element)

  function identify(element: HTMLElement): ElementIdentity {
    const parts: string[] = [segmentOf(element)]
    for (let parent = nearestPpAncestor(element); parent; parent = nearestPpAncestor(parent)) {
      parts.unshift(segmentOf(parent))
    }
    const path = [pageId, ...parts].join('/')
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

  // querySelectorAll order is document order; the segment map is grouped.
  const tagged = [...root.querySelectorAll('[data-pp]')].filter(
    (node): node is HTMLElement => node instanceof HTMLElement && segments.has(node),
  )
  return { identify, tagged }
}

export function cssSelectorFor(element: HTMLElement): string {
  const document = element.ownerDocument
  const unique = (selector: string) => document.querySelectorAll(selector).length === 1
  const candidates: string[] = []
  const pp = element.getAttribute('data-pp')
  const key = element.getAttribute('data-pp-key')
  if (pp && key) {
    candidates.push(`[data-pp="${escapeSelectorValue(pp)}"][data-pp-key="${escapeSelectorValue(key)}"]`)
  }
  if (pp) candidates.push(`[data-pp="${escapeSelectorValue(pp)}"]`)
  const testid = element.getAttribute('data-testid')
  if (testid) candidates.push(`[data-testid="${escapeSelectorValue(testid)}"]`)
  if (element.id) candidates.push(`#${escapeSelectorValue(element.id)}`)
  for (const selector of candidates) {
    if (unique(selector)) return selector
  }
  return structuralSelector(element)
}

/** `:nth-of-type` chain up to the nearest uniquely identifiable ancestor. */
function structuralSelector(element: HTMLElement): string {
  const parts: string[] = []
  let current: Element | null = element
  while (current && current !== element.ownerDocument.documentElement) {
    const parent: Element | null = current.parentElement
    if (current !== element && current.id && element.ownerDocument.querySelectorAll(
      `#${escapeSelectorValue(current.id)}`,
    ).length === 1) {
      parts.unshift(`#${escapeSelectorValue(current.id)}`)
      break
    }
    const tag = current.tagName.toLowerCase()
    const sameTag = parent
      ? [...parent.children].filter((child) => child.tagName === current!.tagName)
      : []
    parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(current) + 1})` : tag)
    current = parent
  }
  return parts.join(' > ')
}

export function resolveTarget(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof Element)) return null
  if (isOwned(start)) return null
  const tagged = start.closest('[data-pp]')
  if (tagged instanceof HTMLElement) return tagged
  const testid = start.closest('[data-testid]')
  if (testid instanceof HTMLElement) return testid
  const withId = start.closest('[id]')
  if (withId instanceof HTMLElement && withId.id) return withId
  return start instanceof HTMLElement ? start : start.parentElement
}

export function resolveIdentity(element: HTMLElement, pageId: string): ElementIdentity {
  return buildIdentityIndex(element.ownerDocument, pageId).identify(element)
}

/** Smallest automatic tile. 16px tiles put v2 waves at ~2px periods, which any resampling (html-to-image, zoom, scaled screenshots) blurs away. */
export const MIN_AUTO_PATTERN_SIZE = 32

/**
 * Tile size for a tag. `data-pp-pattern-size` wins; otherwise `fallback` when
 * the element's shorter side holds 1.5 tiles, else 32, so a crop of a small
 * control still contains a whole period. Carrier painting and the codebook
 * both use this, so they agree.
 */
export function tagPatternSize(element: Element, fallback = DEFAULT_PATTERN_SIZE): number {
  const explicit = Number(element.getAttribute('data-pp-pattern-size'))
  if (explicit) return clampPatternSize(explicit)
  const preferred = clampPatternSize(fallback)
  const rect = element.getBoundingClientRect()
  const side = Math.min(rect.width, rect.height)
  if (!side || side >= preferred * 1.5) return preferred
  return Math.min(preferred, MIN_AUTO_PATTERN_SIZE)
}

export function descriptorFor(
  element: HTMLElement,
  identity: ElementIdentity,
  fallbackPatternSize = DEFAULT_PATTERN_SIZE,
): ComponentDescriptor {
  return {
    path: identity.path,
    type: identity.type,
    depth: identity.depth,
    ...(identity.source ? { source: identity.source } : {}),
    patternSize: tagPatternSize(element, fallbackPatternSize),
  }
}

export function collectCodebook(
  root: ParentNode,
  pageId: string,
  fallbackPatternSize = DEFAULT_PATTERN_SIZE,
): ComponentDescriptor[] {
  const index = buildIdentityIndex(root, pageId)
  return index.tagged.map((node) => descriptorFor(node, index.identify(node), fallbackPatternSize))
}
