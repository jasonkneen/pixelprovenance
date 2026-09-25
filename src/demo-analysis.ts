import {
  DEFAULT_INTENSITY,
  DEFAULT_PATTERN_SIZE,
  HIERARCHY_SCORE_MARGIN,
  PATTERN_VERSION,
  createPatternPayload,
  generatePattern,
  patternWaves,
  rankByHierarchy,
  resolvePatternSize,
  type ComponentDescriptor,
  type PatternMatrix,
} from './pattern.js'
import { detectSpectral, spectralCost } from './spectral.js'

export interface ScreenshotAnalysisOptions {
  patternSize?: number
  intensity?: number
  scales?: number[]
  step?: number
  /** Minimum score kept when preferring deeper hierarchical matches. */
  threshold?: number
  /** Score slack for letting a deeper path beat a slightly stronger parent. */
  hierarchyMargin?: number
}

export interface ScreenshotMatch {
  component: ComponentDescriptor
  score: number
  x: number
  y: number
  tileSize: number
}

const ROBUST_BLOCKS_PER_AXIS = 8
const ROBUST_EDGE_RANGE = 12
const ROBUST_TRIM_RATIO = 0.2
const MIN_ROBUST_BLOCKS = 8
const MAX_ANALYSIS_SAMPLES = 500_000_000

function patchSampleCount(tileSize: number): number {
  const stride = Math.max(1, Math.floor(tileSize / 16))
  const blockSize = Math.max(2, Math.floor(tileSize / ROBUST_BLOCKS_PER_AXIS))
  const blockStride = Math.max(1, Math.floor(blockSize / 4))
  return Math.ceil(tileSize / stride) ** 2 +
    Math.floor(tileSize / blockSize) ** 2 * Math.ceil(blockSize / blockStride) ** 2
}

function correlationFromMoments(
  observedSum: number,
  observedSquareSum: number,
  expectedSum: number,
  expectedSquareSum: number,
  productSum: number,
  count: number,
): number {
  if (count === 0) return 0
  const numerator = productSum - (observedSum * expectedSum) / count
  const observedVariance =
    observedSquareSum - (observedSum * observedSum) / count
  const expectedVariance =
    expectedSquareSum - (expectedSum * expectedSum) / count
  const denominator = Math.sqrt(
    Math.max(0, observedVariance) * Math.max(0, expectedVariance),
  )
  return denominator === 0 ? 0 : numerator / denominator
}

function compareRobustChromaPatch(
  data: Uint8ClampedArray,
  width: number,
  startX: number,
  startY: number,
  expected: PatternMatrix,
): number {
  const tileSize = expected.length
  const blockSize = Math.max(2, Math.floor(tileSize / ROBUST_BLOCKS_PER_AXIS))
  const sampleStride = Math.max(1, Math.floor(blockSize / 4))
  const blockScores: number[] = []

  for (
    let blockY = 0;
    blockY + blockSize <= tileSize;
    blockY += blockSize
  ) {
    for (
      let blockX = 0;
      blockX + blockSize <= tileSize;
      blockX += blockSize
    ) {
      let observedSum = 0
      let expectedSum = 0
      let observedSquareSum = 0
      let expectedSquareSum = 0
      let productSum = 0
      let observedMinimum = Number.POSITIVE_INFINITY
      let observedMaximum = Number.NEGATIVE_INFINITY
      let count = 0

      for (let y = blockY; y < blockY + blockSize; y += sampleStride) {
        for (let x = blockX; x < blockX + blockSize; x += sampleStride) {
          const offset = ((startY + y) * width + startX + x) * 4
          const observed = data[offset + 3] === 0 ? 0 :
            data[offset] - (data[offset + 1] + data[offset + 2]) / 2
          const expectedValue = expected[y][x]
          observedSum += observed
          expectedSum += expectedValue
          observedSquareSum += observed * observed
          expectedSquareSum += expectedValue * expectedValue
          productSum += observed * expectedValue
          observedMinimum = Math.min(observedMinimum, observed)
          observedMaximum = Math.max(observedMaximum, observed)
          count += 1
        }
      }

      // Strong colour transitions are ordinary interface content, not the
      // faint carrier. Excluding the whole local block keeps borders, text and
      // avatars from dominating the correlation while retaining flat regions.
      if (observedMaximum - observedMinimum > ROBUST_EDGE_RANGE) continue
      blockScores.push(
        correlationFromMoments(
          observedSum,
          observedSquareSum,
          expectedSum,
          expectedSquareSum,
          productSum,
          count,
        ),
      )
    }
  }

  if (blockScores.length < MIN_ROBUST_BLOCKS) return 0
  blockScores.sort((first, second) => first - second)
  const trim = Math.floor(blockScores.length * ROBUST_TRIM_RATIO)
  const retained = blockScores.slice(trim, blockScores.length - trim)
  return retained.reduce((sum, score) => sum + score, 0) / retained.length
}

function comparePatch(
  data: Uint8ClampedArray,
  width: number,
  startX: number,
  startY: number,
  expected: PatternMatrix,
): number {
  const tileSize = expected.length
  const sampleStride = Math.max(1, Math.floor(tileSize / 16))
  let observedLumaSum = 0
  let observedChromaSum = 0
  let expectedSum = 0
  let observedLumaSquareSum = 0
  let observedChromaSquareSum = 0
  let expectedSquareSum = 0
  let lumaProductSum = 0
  let chromaProductSum = 0
  let count = 0

  for (let y = 0; y < tileSize; y += sampleStride) {
    for (let x = 0; x < tileSize; x += sampleStride) {
      const offset = ((startY + y) * width + startX + x) * 4
      // Stored RGB under zero alpha is not visible screenshot evidence.
      const visible = data[offset + 3] === 0 ? 0 : 1
      const red = data[offset] * visible
      const green = data[offset + 1] * visible
      const blue = data[offset + 2] * visible
      const observedLuma = (red + green + blue) / 3
      const observedChroma = red - (green + blue) / 2
      const expectedValue = expected[y][x]
      observedLumaSum += observedLuma
      observedChromaSum += observedChroma
      expectedSum += expectedValue
      observedLumaSquareSum += observedLuma * observedLuma
      observedChromaSquareSum += observedChroma * observedChroma
      expectedSquareSum += expectedValue * expectedValue
      lumaProductSum += observedLuma * expectedValue
      chromaProductSum += observedChroma * expectedValue
      count += 1
    }
  }

  return Math.max(
    correlationFromMoments(
      observedLumaSum,
      observedLumaSquareSum,
      expectedSum,
      expectedSquareSum,
      lumaProductSum,
      count,
    ),
    correlationFromMoments(
      observedChromaSum,
      observedChromaSquareSum,
      expectedSum,
      expectedSquareSum,
      chromaProductSum,
      count,
    ),
    compareRobustChromaPatch(data, width, startX, startY, expected),
  )
}

/**
 * Full-resolution chroma correlation over the whole capture, with the tile
 * repeated cyclically from the best-scoring origin. The carrier tiles across
 * its element, so every pixel is another look at it; using all of them
 * averages out the 8-bit posterisation a single sampled tile cannot. Other
 * content in the capture only dilutes this score, so callers keep the max.
 */
function pooledChromaScore(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  originX: number,
  originY: number,
  expected: PatternMatrix,
): number {
  const tileSize = expected.length
  const phaseX = originX % tileSize
  const phaseY = originY % tileSize
  let observedSum = 0
  let expectedSum = 0
  let observedSquareSum = 0
  let expectedSquareSum = 0
  let productSum = 0
  let count = 0
  for (let y = 0; y < height; y += 1) {
    const row = expected[(y - phaseY + tileSize) % tileSize]
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      if (data[offset + 3] === 0) continue
      const observed = data[offset] - (data[offset + 1] + data[offset + 2]) / 2
      const expectedValue = row[(x - phaseX + tileSize) % tileSize]
      observedSum += observed
      expectedSum += expectedValue
      observedSquareSum += observed * observed
      expectedSquareSum += expectedValue * expectedValue
      productSum += observed * expectedValue
      count += 1
    }
  }
  return correlationFromMoments(
    observedSum,
    observedSquareSum,
    expectedSum,
    expectedSquareSum,
    productSum,
    count,
  )
}

export function analyzeScreenshot(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  components: ComponentDescriptor[],
  options: ScreenshotAnalysisOptions = {},
): ScreenshotMatch[] {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    data.length < width * height * 4
  ) {
    throw new RangeError('Screenshot pixels do not match the declared dimensions')
  }
  if (width * height > 8_000_000) {
    throw new RangeError('That capture is too large. Crop one app panel and try again.')
  }
  if (options.step !== undefined && (!Number.isFinite(options.step) || options.step <= 0)) {
    throw new RangeError('Analysis step must be a positive finite number')
  }
  if (options.threshold !== undefined && !Number.isFinite(options.threshold)) {
    throw new RangeError('Analysis threshold must be finite')
  }
  if (options.hierarchyMargin !== undefined &&
      (!Number.isFinite(options.hierarchyMargin) || options.hierarchyMargin < 0)) {
    throw new RangeError('Hierarchy margin must be finite and nonnegative')
  }

  const fallbackSize = options.patternSize ?? DEFAULT_PATTERN_SIZE
  const intensity = options.intensity ?? DEFAULT_INTENSITY
  const scales = options.scales?.length ? options.scales : [1, 2]
  if (components.length > 512 || scales.length > 4) {
    throw new RangeError('Analysis supports at most 512 components and 4 scales')
  }
  for (const scale of scales) {
    if (!Number.isFinite(scale) || scale < 0.25 || scale > 2) {
      throw new RangeError('Screenshot scales must be between 0.25 and 2')
    }
  }
  // Include both the coarse search and the maximum local refinement area.
  // Preflight all entries so no component starts scanning before the total is known.
  let sampleCount = 0
  const isV2 = (component: ComponentDescriptor) =>
    (component.patternVersion ?? PATTERN_VERSION) === 2
  for (const scale of scales) {
    const v2Sizes = new Map<number, number>()
    for (const component of components.filter(isV2)) {
      const tileSize = Math.round(resolvePatternSize(component, fallbackSize) * scale)
      v2Sizes.set(tileSize, (v2Sizes.get(tileSize) ?? 0) + 1)
    }
    for (const [tileSize, count] of v2Sizes) {
      if (tileSize < 16 || tileSize > 512 || tileSize > width || tileSize > height) continue
      sampleCount += spectralCost(width, height, tileSize, count, 'whole')
    }
  }
  for (const component of components.filter((component) => !isV2(component))) {
    for (const scale of scales) {
      const tileSize = Math.round(resolvePatternSize(component, fallbackSize) * scale)
      if (tileSize < 16 || tileSize > 512 || tileSize > width || tileSize > height) continue
      const step = Math.max(1, Math.round(options.step ?? tileSize / 8))
      const positionsX = width - tileSize + 1
      const positionsY = height - tileSize + 1
      const coarse = (Math.floor((positionsX - 1) / step) + 1) *
        (Math.floor((positionsY - 1) / step) + 1)
      const refinement = Math.min(positionsX, 2 * step + 1) * Math.min(positionsY, 2 * step + 1)
      sampleCount += (coarse + refinement) * patchSampleCount(tileSize) + width * height
    }
  }
  if (sampleCount > MAX_ANALYSIS_SAMPLES) {
    throw new RangeError('Analysis exceeds the computation budget. Crop a smaller region or increase step.')
  }
  const matches: ScreenshotMatch[] = []

  // v2: shift-invariant spectral detection over the whole capture, batched by tile size.
  const v2Components = components.filter(isV2)
  const v2Best = new Map<ComponentDescriptor, ScreenshotMatch>(
    v2Components.map((component) => [component, {
      component,
      score: 0,
      x: 0,
      y: 0,
      tileSize: resolvePatternSize(component, fallbackSize),
    }]),
  )
  for (const scale of scales) {
    const bySize = new Map<number, ComponentDescriptor[]>()
    for (const component of v2Components) {
      const tileSize = Math.round(resolvePatternSize(component, fallbackSize) * scale)
      if (tileSize < 16 || tileSize > 512 || tileSize > width || tileSize > height) continue
      bySize.set(tileSize, [...(bySize.get(tileSize) ?? []), component])
    }
    for (const [tileSize, batch] of bySize) {
      const results = detectSpectral(data, width, height, tileSize, batch.map((component) => {
        const payload = createPatternPayload(component)
        return { waves: patternWaves(payload), pattern: generatePattern(payload, tileSize, intensity, 2) }
      }), { mode: 'whole', threshold: options.threshold ?? 0 })
      batch.forEach((component, index) => {
        const result = results[index]
        const previous = v2Best.get(component)!
        if (result.score > previous.score) {
          v2Best.set(component, { component, score: result.score, x: result.x, y: result.y, tileSize })
        }
      })
    }
  }
  matches.push(...v2Best.values())

  for (const component of components.filter((component) => !isV2(component))) {
    const baseSize = resolvePatternSize(component, fallbackSize)
    let best: ScreenshotMatch = {
      component,
      score: 0,
      x: 0,
      y: 0,
      tileSize: baseSize,
    }

    for (const scale of scales) {
      const tileSize = Math.round(baseSize * scale)
      if (
        !Number.isFinite(scale) ||
        tileSize < 16 ||
        tileSize > 512 ||
        tileSize > width ||
        tileSize > height
      ) {
        continue
      }

      const expected = generatePattern(
        createPatternPayload(component),
        tileSize,
        intensity,
        component.patternVersion,
      )
      const step = Math.max(1, Math.round(options.step ?? tileSize / 8))
      let scaleBest: ScreenshotMatch = {
        component,
        score: 0,
        x: 0,
        y: 0,
        tileSize,
      }

      for (let y = 0; y <= height - tileSize; y += step) {
        for (let x = 0; x <= width - tileSize; x += step) {
          const score = comparePatch(data, width, x, y, expected)
          if (score > scaleBest.score) {
            scaleBest = { component, score, x, y, tileSize }
          }
        }
      }

      const refineStartX = Math.max(0, scaleBest.x - step)
      const refineEndX = Math.min(width - tileSize, scaleBest.x + step)
      const refineStartY = Math.max(0, scaleBest.y - step)
      const refineEndY = Math.min(height - tileSize, scaleBest.y + step)
      for (let y = refineStartY; y <= refineEndY; y += 1) {
        for (let x = refineStartX; x <= refineEndX; x += 1) {
          const score = comparePatch(data, width, x, y, expected)
          if (score > scaleBest.score) {
            scaleBest = { component, score, x, y, tileSize }
          }
        }
      }

      const pooled = pooledChromaScore(data, width, height, scaleBest.x, scaleBest.y, expected)
      if (pooled > scaleBest.score) scaleBest = { ...scaleBest, score: pooled }

      if (scaleBest.score > best.score) best = scaleBest
    }

    matches.push(best)
  }

  return rankByHierarchy(
    matches.map((match) => ({
      ...match,
      path: match.component.path,
      depth: match.component.depth,
    })),
    {
      threshold: options.threshold ?? 0,
      margin: options.hierarchyMargin ?? HIERARCHY_SCORE_MARGIN,
    },
  ).map(({ path: _path, depth: _depth, ...match }) => match)
}
