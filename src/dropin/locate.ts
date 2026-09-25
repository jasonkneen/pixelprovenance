import type { IdentityIndex } from './identity.js'
import type { CropCandidate, SelectionRect } from './types.js'

/** An element must cover at least this share of the crop to be its subject. */
const MIN_SUBJECT_COVERAGE = 0.5
const MAX_CANDIDATES = 5

/**
 * Rank tagged elements against a page-coordinate crop using layout geometry.
 * `coverage` is the share of the crop the element covers; `iou` is overlap
 * over union. The subject is the best-IoU element among those covering most
 * of the crop, so a tight crop on a chip reports the chip while a crop of
 * card background reports the card, not a sliver of a neighbouring button.
 */
export function locateCrop(
  rect: SelectionRect,
  index: IdentityIndex,
  scroll: { x: number; y: number },
): CropCandidate[] {
  const cropArea = Math.max(1, rect.w * rect.h)
  const candidates: CropCandidate[] = []
  for (const element of index.tagged) {
    const box = element.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue
    const left = box.left + scroll.x
    const top = box.top + scroll.y
    const overlapW = Math.min(rect.x + rect.w, left + box.width) - Math.max(rect.x, left)
    const overlapH = Math.min(rect.y + rect.h, top + box.height) - Math.max(rect.y, top)
    if (overlapW <= 0 || overlapH <= 0) continue
    const overlap = overlapW * overlapH
    const identity = index.identify(element)
    candidates.push({
      path: identity.path,
      type: identity.type,
      depth: identity.depth,
      selector: identity.selector,
      ...(identity.source ? { source: identity.source } : {}),
      coverage: round(overlap / cropArea),
      iou: round(overlap / (cropArea + box.width * box.height - overlap)),
      element,
    })
  }
  const subjects = candidates.filter((candidate) => candidate.coverage >= MIN_SUBJECT_COVERAGE)
  const rank = (first: CropCandidate, second: CropCandidate) =>
    second.iou - first.iou || second.depth - first.depth
  return [...subjects.sort(rank), ...candidates.filter((c) => !subjects.includes(c)).sort(rank)]
    .slice(0, MAX_CANDIDATES)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
