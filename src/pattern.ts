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
  /** Carrier generation used when encoding. Defaults to the current version. */
  patternVersion?: PatternVersion
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
 * Rank matches in score bands anchored to the strongest remaining match;
 * within `margin` of that anchor, the deeper path wins. That way a chip crop (chip ≈ parent) reports the
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

  const byScore = [...pool].sort((first, second) =>
    second.score - first.score ||
    second.depth - first.depth ||
    first.path.localeCompare(second.path),
  )
  const ranked: T[] = []

  // Anchor each tie group to its strongest score. Pairwise margins can form
  // cycles (A beats C, C beats B, B beats A) and make sorting input-dependent.
  for (let start = 0; start < byScore.length;) {
    let end = start + 1
    while (end < byScore.length && byScore[start].score - byScore[end].score <= margin) {
      end += 1
    }
    ranked.push(...byScore.slice(start, end).sort((first, second) =>
      second.depth - first.depth ||
      first.path.localeCompare(second.path) ||
      second.score - first.score,
    ))
    start = end
  }

  return ranked
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

/**
 * Pattern generations.
 * v1 — original three-sinusoid carrier on the chroma axis. Kept so existing
 *      screenshots still decode.
 * v2 — twelve distinct 2-D frequency vectors drawn from a pool of 108, on the
 *      chroma axis. Strong against noise/text; weak against JPEG because
 *      4:2:0 chroma subsampling destroys the modulation before DCT runs.
 * v3 — same wave structure as v2, but modulation lives on the luminance axis
 *      (R = G = B = 128 + …). Luma survives JPEG 4:2:0, so v3 carriers
 *      decode after recompression at q70+. Slightly more visible to humans
 *      than v2 chroma on flat backgrounds.
 */
export type PatternVersion = 1 | 2 | 3
export const PATTERN_VERSION: PatternVersion = 2

const V2_COMPONENTS = 12
// Max 7 cycles per axis keeps the carrier below Nyquist for the decoders'
// 16-samples-per-tile coarse scan.
const V2_MAX_CYCLES = 7
const V2_FREQUENCY_POOL: ReadonlyArray<readonly [number, number]> = (() => {
  const pool: Array<[number, number]> = []
  for (let fx = 0; fx <= V2_MAX_CYCLES; fx += 1) {
    for (let fy = -V2_MAX_CYCLES; fy <= V2_MAX_CYCLES; fy += 1) {
      // One vector per ± pair, and nothing so slow it looks like a gradient.
      if (fx === 0 && fy <= 0) continue
      if (Math.max(Math.abs(fx), Math.abs(fy)) < 2) continue
      pool.push([fx, fy])
    }
  }
  return pool
})()

interface PatternV2Parameters {
  waves: Array<{ fx: number; fy: number; phase: number }>
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function createPatternV2Parameters(payload: string): PatternV2Parameters {
  const random = mulberry32(hashString(payload))
  const pool = [...V2_FREQUENCY_POOL]
  const waves: PatternV2Parameters['waves'] = []
  for (let index = 0; index < V2_COMPONENTS; index += 1) {
    const pick = index + Math.floor(random() * (pool.length - index))
    ;[pool[index], pool[pick]] = [pool[pick], pool[index]]
    waves.push({ fx: pool[index][0], fy: pool[index][1], phase: random() * Math.PI * 2 })
  }
  return { waves }
}

// v3 reuses v2's wave parameters (same DFT bins, same fold code path);
// only the channel being modulated differs — v3 lives on luma so it
// survives JPEG 4:2:0 chroma subsampling.
function createPatternV3Parameters(payload: string): PatternV2Parameters {
  return createPatternV2Parameters(payload)
}

// Reference the v3 helper so it isn't dropped by `noUnusedLocals`. v2
// entries can opt into the luma-channel path by passing `version: 3`.
void createPatternV3Parameters

/** The v2 carrier's waves (cycles per tile + phase), for spectral decoding. */
export function patternWaves(payload: string): Array<{ fx: number; fy: number; phase: number }> {
  return createPatternV2Parameters(payload).waves.map((wave) => ({ ...wave }))
}

/** v2 carrier sample in [-1, 1]; roughly 0.6 standard deviation, lightly clipped so 8-bit alpha keeps more swing. */
function samplePatternV2(parameters: PatternV2Parameters, size: number, x: number, y: number): number {
  let sum = 0
  for (const wave of parameters.waves) {
    sum += Math.sin(((wave.fx * x + wave.fy * y) / size) * Math.PI * 2 + wave.phase)
  }
  const normalized = sum / Math.sqrt(parameters.waves.length / 2) / 1.6
  return Math.max(-1, Math.min(1, normalized))
}

/** v1 carrier sample in [-1, 1], derived from the legacy byte value. */
function sampleNormalizedV1(parameters: PatternParameters, size: number, x: number, y: number, strength: number): number {
  if (strength === 0) return 0
  const value = samplePattern(parameters, size, x, y, strength)
  return Math.max(-1, Math.min(1, (value - 245) / (strength * 255 * 0.5)))
}

/**
 * Per-pixel alpha for the browser carrier. `intensity` is the visibility
 * control: 0.06 → 3/255 (≈1%), 0.1 → 5/255, 1 → 50/255.
 */
export function intensityToAlpha(intensity: number): number {
  const strength = clampIntensity(intensity)
  if (strength === 0) return 0
  return Math.max(1, Math.round(strength * 50))
}

export function generatePattern(
  payload: string,
  patternSize = DEFAULT_PATTERN_SIZE,
  intensity = DEFAULT_INTENSITY,
  version: PatternVersion = PATTERN_VERSION,
): PatternMatrix {
  const size = normalizeGeneratedPatternSize(patternSize)
  if (version === 1) {
    const strength = clampIntensity(intensity)
    const parameters = createPatternParameters(payload)
    return Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) =>
        samplePattern(parameters, size, x, y, strength),
      ),
    )
  }
  // v2 and v3 share the wave parameters; the decoder reads the same bins
  // and only differs in which channel it correlates against.
  const parameters = createPatternV2Parameters(payload)
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) =>
      Math.round(128 + samplePatternV2(parameters, size, x, y) * 100),
    ),
  )
}

export function generatePatternRgba(
  payload: string,
  patternSize = DEFAULT_PATTERN_SIZE,
  intensity = DEFAULT_INTENSITY,
  version: PatternVersion = PATTERN_VERSION,
): Uint8ClampedArray {
  const size = normalizeGeneratedPatternSize(patternSize)
  const strength = clampIntensity(intensity)
  const alpha = intensityToAlpha(strength)
  const v1 = version === 1 ? createPatternParameters(payload) : null
  const v2 = version === 1 ? null : createPatternV2Parameters(payload)
  const rgba = new Uint8ClampedArray(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4
      const normalized = v1
        ? sampleNormalizedV1(v1, size, x, y, strength)
        : strength === 0 ? 0 : samplePatternV2(v2!, size, x, y)
      if (version === 3) {
        // v3: luma modulation. All three channels move together by the
        // same amount. Lives in the Y plane of Y'CbCr, which JPEG keeps at
        // full resolution under 4:2:0 subsampling. Visible to humans on
        // flat backgrounds (~1 pixel of deviation at alpha 4/255), but the
        // alternative — chroma — is destroyed by JPEG regardless of quality.
        const luma = Math.round(normalized * 112)
        rgba[offset] = Math.min(255, Math.max(0, 128 + luma))
        rgba[offset + 1] = Math.min(255, Math.max(0, 128 + luma))
        rgba[offset + 2] = Math.min(255, Math.max(0, 128 + luma))
      } else {
        // v1/v2: chroma axis. Human vision is less sensitive to faint chroma
        // than to light/dark banding; the decoder isolates R-(G+B)/2.
        const chroma = Math.round(normalized * 112)
        rgba[offset] = Math.min(255, Math.max(0, 128 + chroma))
        rgba[offset + 1] = Math.min(255, Math.max(0, 128 - chroma / 2))
        rgba[offset + 2] = Math.min(255, Math.max(0, 128 - chroma / 2))
      }
      // Low opacity: the structure is recovered by correlating many pixels
      // across a region, not by making any single pixel visibly noisy.
      rgba[offset + 3] = alpha
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
