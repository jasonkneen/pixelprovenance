export interface SourceLocation {
  file: string
  line: number
  column: number
}

export interface ComponentDescriptor {
  path: string
  type: string
  depth: number
  /**
   * Code location embedded into the frequency pattern when present.
   * Matching a crop recovers this mapping from the noise itself — the
   * registry is only the set of known embeddings to correlate against,
   * not a post-hoc path→source lookup.
   */
  source?: SourceLocation
  /**
   * 1× signal tile size used when this region was encoded.
   * Smaller leaf tags (chips, badges) should use 16–32 so a crop can cover a tile.
   * Not part of the pattern seed (size is a render parameter).
   */
  patternSize?: number
}

export type PatternMatrix = number[][]

export const DEFAULT_PATTERN_SIZE = 64
export const DEFAULT_INTENSITY = 0.08
/** Score margin for treating a deeper path as a tie with the best match. */
export const HIERARCHY_SCORE_MARGIN = 0.08

export interface RankableMatch {
  path: string
  depth: number
  score: number
}

class SeededRandom {
  private seed: number

  constructor(seed: number) {
    this.seed = seed
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280
    return this.seed / 233280
  }
}

interface PatternParameters {
  horizontalFrequency: number
  verticalFrequency: number
  diagonalFrequency: number
  horizontalPhase: number
  verticalPhase: number
  diagonalPhase: number
  horizontalAmplitude: number
  verticalAmplitude: number
  diagonalAmplitude: number
}

export function hashString(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return hash >>> 0
}

export function clampPatternSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PATTERN_SIZE
  return Math.min(256, Math.max(16, Math.round(value)))
}

function normalizeGeneratedPatternSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PATTERN_SIZE
  return Math.min(512, Math.max(16, Math.round(value)))
}

export function clampIntensity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_INTENSITY
  return Math.min(1, Math.max(0, value))
}

/** Resolve the 1× tile size for a registry entry. */
export function resolvePatternSize(
  component: Pick<ComponentDescriptor, 'patternSize'>,
  fallback = DEFAULT_PATTERN_SIZE,
): number {
  return clampPatternSize(component.patternSize ?? fallback)
}

/** Path segment count: `A/B/C` → 3. */
export function pathDepth(path: string): number {
  if (!path) return 0
  return path.split('/').filter(Boolean).length
}

/** True when `ancestor` is `descendant` or a strict path prefix of it. */
export function isPathAncestor(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true
  return descendant.startsWith(`${ancestor}/`)
}

/**
 * Rank matches so score wins first; when two scores are within `margin`,
 * the deeper path wins. That way a chip crop (chip ≈ parent) reports the
 * chip, while a clearly stronger parent still wins on a full-card crop.
 */
export function rankByHierarchy<T extends RankableMatch>(
  matches: T[],
  options: { threshold?: number; margin?: number } = {},
): T[] {
  if (matches.length <= 1) return [...matches]

  const threshold = options.threshold ?? 0
  const margin = options.margin ?? HIERARCHY_SCORE_MARGIN
  const aboveThreshold = matches.filter((match) => match.score >= threshold)
  const pool = aboveThreshold.length > 0 ? aboveThreshold : matches

  return [...pool].sort((first, second) => {
    const scoreDelta = Math.abs(first.score - second.score)
    if (scoreDelta <= margin) {
      if (first.depth !== second.depth) return second.depth - first.depth
      if (isPathAncestor(first.path, second.path) && first.path !== second.path) {
        return 1
      }
      if (isPathAncestor(second.path, first.path) && first.path !== second.path) {
        return -1
      }
      return first.path.localeCompare(second.path)
    }

    if (second.score !== first.score) return second.score - first.score
    if (second.depth !== first.depth) return second.depth - first.depth
    return first.path.localeCompare(second.path)
  })
}

/**
 * Deterministic seed string for the frequency pattern.
 * Path, type, depth, and — when provided — source file:line:column are all
 * hashed into the noise. Two tags with the same path but different source
 * produce different carriers; the mapping lives in the pixels.
 */
export function createPatternPayload(component: ComponentDescriptor): string {
  // Fixed key order so the seed is stable across runtimes.
  const body: {
    p: string
    t: string
    d: number
    s?: { f: string; l: number; c: number }
  } = {
    p: component.path,
    t: component.type,
    d: component.depth,
  }

  if (component.source) {
    body.s = {
      f: component.source.file,
      l: component.source.line,
      c: component.source.column,
    }
  }

  return JSON.stringify(body)
}

function createPatternParameters(payload: string): PatternParameters {
  const seed = hashString(payload)
  const random = new SeededRandom(seed)

  return {
    horizontalFrequency: 2 + (seed % 5),
    // Keep the signed shifts used by the original prototype. Changing these
    // to unsigned shifts changes the signal for roughly half of all payloads
    // and makes existing screenshots impossible to identify.
    verticalFrequency: 6 + ((seed >> 8) % 5),
    diagonalFrequency: 12 + ((seed >> 16) % 6),
    horizontalPhase: random.next() * Math.PI * 2,
    verticalPhase: random.next() * Math.PI * 2,
    diagonalPhase: random.next() * Math.PI * 2,
    horizontalAmplitude: 0.4 + random.next() * 0.3,
    verticalAmplitude: 0.3 + random.next() * 0.3,
    diagonalAmplitude: 0.3 + random.next() * 0.2,
  }
}

function samplePattern(
  parameters: PatternParameters,
  size: number,
  x: number,
  y: number,
  strength: number,
): number {
  const horizontal =
    Math.sin(
      (x / size) * parameters.horizontalFrequency * Math.PI * 2 +
      parameters.horizontalPhase,
    ) * parameters.horizontalAmplitude
  const vertical =
    Math.sin(
      (y / size) * parameters.verticalFrequency * Math.PI * 2 +
      parameters.verticalPhase,
    ) * parameters.verticalAmplitude
  const diagonal =
    Math.sin(
      (x / size + y / size) * parameters.diagonalFrequency * Math.PI * 2 +
      parameters.diagonalPhase,
    ) * parameters.diagonalAmplitude
  const variation = Math.floor(
    ((horizontal + vertical + diagonal) / 3) * strength * 255,
  )
  return Math.min(255, Math.max(0, 245 + variation))
}

export function generatePattern(
  payload: string,
  patternSize = DEFAULT_PATTERN_SIZE,
  intensity = DEFAULT_INTENSITY,
): PatternMatrix {
  const size = normalizeGeneratedPatternSize(patternSize)
  const strength = clampIntensity(intensity)
  const parameters = createPatternParameters(payload)

  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) =>
      samplePattern(parameters, size, x, y, strength),
    ),
  )
}

export function generatePatternRgba(
  payload: string,
  patternSize = DEFAULT_PATTERN_SIZE,
  intensity = DEFAULT_INTENSITY,
): Uint8ClampedArray {
  const size = normalizeGeneratedPatternSize(patternSize)
  const strength = clampIntensity(intensity)
  const parameters = createPatternParameters(payload)
  const rgba = new Uint8ClampedArray(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4
      const value = samplePattern(parameters, size, x, y, strength)
      // Put the carrier in a roughly luminance-neutral red/cyan axis. Human
      // vision is considerably less sensitive to this faint chroma variation
      // than to light/dark banding, while a decoder can isolate R-(G+B)/2.
      const normalized = strength === 0
        ? 0
        : Math.max(
            -1,
            Math.min(1, (value - 245) / (strength * 255 * 0.5)),
          )
      const chroma = Math.round(normalized * 112)
      rgba[offset] = Math.min(255, Math.max(0, 128 + chroma))
      rgba[offset + 1] = Math.min(255, Math.max(0, 128 - chroma / 2))
      rgba[offset + 2] = Math.min(255, Math.max(0, 128 - chroma / 2))
      // Keep each pixel close to one percent opacity. The structure is recovered
      // by correlating many pixels across a region, not by making any single
      // pixel visibly noisy.
      rgba[offset + 3] = strength === 0 ? 0 : 3
    }
  }

  return rgba
}

export function comparePatterns(first: PatternMatrix, second: PatternMatrix): number {
  const height = Math.min(first.length, second.length)
  const width = Math.min(first[0]?.length ?? 0, second[0]?.length ?? 0)
  if (height === 0 || width === 0) return 0

  let firstSum = 0
  let secondSum = 0
  let firstSquareSum = 0
  let secondSquareSum = 0
  let productSum = 0
  const count = width * height

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const firstValue = first[y][x]
      const secondValue = second[y][x]
      firstSum += firstValue
      secondSum += secondValue
      firstSquareSum += firstValue * firstValue
      secondSquareSum += secondValue * secondValue
      productSum += firstValue * secondValue
    }
  }

  const numerator = productSum - (firstSum * secondSum) / count
  const firstVariance = firstSquareSum - (firstSum * firstSum) / count
  const secondVariance = secondSquareSum - (secondSum * secondSum) / count
  const denominator = Math.sqrt(Math.max(0, firstVariance) * Math.max(0, secondVariance))

  return denominator === 0 ? 0 : numerator / denominator
}
