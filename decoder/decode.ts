#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { PNG } from 'pngjs'

import {
  DEFAULT_INTENSITY,
  DEFAULT_PATTERN_SIZE,
  HIERARCHY_SCORE_MARGIN,
  PATTERN_VERSION,
  comparePatterns,
  createPatternPayload,
  generatePattern,
  patternWaves,
  rankByHierarchy,
  resolvePatternSize,
  type ComponentDescriptor,
  type PatternMatrix,
  type PatternVersion,
} from '../src/pattern.js'
import { detectSpectral, spectralCost } from '../src/spectral.js'

const MAX_IMAGE_BYTES = 100 * 1024 * 1024
const MAX_IMAGE_PIXELS = 25_000_000
const MAX_REGISTRY_BYTES = 1024 * 1024
const MAX_REGISTRY_ENTRIES = 512
const MAX_SCALES = 4
const MAX_PATTERN_SAMPLES = 4_000_000
const MAX_CORRELATION_SAMPLES = 500_000_000
/** v1 carriers need 0.7; v2 carriers separate at 0.5 (unrelated ≤ ~0.4). */
const DEFAULT_THRESHOLD_V1 = 0.7
const DEFAULT_THRESHOLD_V2 = 0.5

function isV2(component: ComponentDescriptor): boolean {
  return (component.patternVersion ?? PATTERN_VERSION) === 2
}

function isV3(component: ComponentDescriptor): boolean {
  return (component.patternVersion ?? PATTERN_VERSION) === 3
}

export function defaultThreshold(components: ComponentDescriptor[]): number {
  // v3 (luma) and v2 (chroma) both decode well at 0.5; v1 needs 0.7.
  if (components.length === 0) return DEFAULT_THRESHOLD_V2
  if (components.every((c) => (c.patternVersion ?? PATTERN_VERSION) === 1)) return DEFAULT_THRESHOLD_V1
  return DEFAULT_THRESHOLD_V2
}

export interface RegistryEntry extends ComponentDescriptor {
  pattern: PatternMatrix
}

export interface ScanResult extends ComponentDescriptor {
  score: number
  count: number
  tileSize: number
}

export interface ScanOptions {
  threshold?: number
  step?: number
}

export interface DecodeOptions extends ScanOptions {
  patternSize?: number
  intensity?: number
  scales?: number[]
}

function assertScanOptions(options: ScanOptions): void {
  if (options.threshold !== undefined && !Number.isFinite(options.threshold)) {
    throw new RangeError('Scan threshold must be a finite number')
  }
  if (options.step !== undefined && (!Number.isFinite(options.step) || options.step <= 0)) {
    throw new RangeError('Scan step must be a positive finite number')
  }
}

function assertRaster(
  data: Uint8Array,
  width: number,
  height: number,
): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('Image dimensions must be positive safe integers')
  }

  const pixelCount = width * height
  if (pixelCount > MAX_IMAGE_PIXELS) {
    throw new RangeError(`Image exceeds the ${MAX_IMAGE_PIXELS.toLocaleString()} pixel limit`)
  }
  if (data.length < pixelCount * 4) {
    throw new RangeError('Pixel buffer is smaller than the declared image dimensions')
  }
}

function readPng(pngBytes: Uint8Array): PNG {
  const pngData = Buffer.from(
    pngBytes.buffer,
    pngBytes.byteOffset,
    pngBytes.byteLength,
  )
  if (pngData.length > MAX_IMAGE_BYTES) {
    throw new RangeError(`PNG exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024} MB input limit`)
  }

  if (pngData.length >= 24 && pngData.subarray(12, 16).toString('ascii') === 'IHDR') {
    const width = pngData.readUInt32BE(16)
    const height = pngData.readUInt32BE(20)
    if (width * height > MAX_IMAGE_PIXELS) {
      throw new RangeError(`PNG exceeds the ${MAX_IMAGE_PIXELS.toLocaleString()} pixel limit`)
    }
    if (pngData.length >= 29 && pngData[28] !== 0) {
      throw new RangeError('Interlaced PNG input is not supported')
    }
  }

  const png = PNG.sync.read(pngData)
  assertRaster(png.data, png.width, png.height)
  return png
}

function assertComponents(components: ComponentDescriptor[]): void {
  if (components.length > MAX_REGISTRY_ENTRIES) {
    throw new RangeError(`Registry exceeds the ${MAX_REGISTRY_ENTRIES} component limit`)
  }

  const paths = new Set<string>()
  for (const [index, component] of components.entries()) {
    if (
      typeof component !== 'object' ||
      component === null ||
      typeof component.path !== 'string' ||
      component.path.length === 0 ||
      component.path.length > 512 ||
      typeof component.type !== 'string' ||
      component.type.length === 0 ||
      component.type.length > 64 ||
      !Number.isInteger(component.depth) ||
      component.depth < 1 ||
      component.depth > 255 ||
      (component.source !== undefined &&
        (typeof component.source !== 'object' ||
          component.source === null ||
          typeof component.source.file !== 'string' ||
          component.source.file.length === 0 ||
          component.source.file.length > 1024 ||
          !Number.isInteger(component.source.line) ||
          component.source.line < 1 ||
          !Number.isInteger(component.source.column) ||
          component.source.column < 1)) ||
      (component.patternSize !== undefined &&
        (!Number.isFinite(component.patternSize) ||
          component.patternSize < 16 ||
          component.patternSize > 256)) ||
      (component.patternVersion !== undefined &&
        component.patternVersion !== 1 &&
        component.patternVersion !== 2 &&
        component.patternVersion !== 3)
    ) {
      throw new TypeError(`Invalid component descriptor at registry index ${index}`)
    }
    if (paths.has(component.path)) {
      throw new TypeError(`Duplicate component path: ${component.path}`)
    }
    paths.add(component.path)
  }
}

function extractTiles(
  data: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  tileSize: number,
): { luma: PatternMatrix; chroma: PatternMatrix } {
  const luma: PatternMatrix = []
  const chroma: PatternMatrix = []

  for (let y = 0; y < tileSize; y += 1) {
    const lumaRow: number[] = []
    const chromaRow: number[] = []
    for (let x = 0; x < tileSize; x += 1) {
      const pixelX = startX + x
      const pixelY = startY + y

      if (pixelX >= width || pixelY >= height) {
        lumaRow.push(0)
        chromaRow.push(0)
        continue
      }

      const offset = (pixelY * width + pixelX) * 4
      // Stored RGB under zero alpha is not visible screenshot evidence.
      const visible = data[offset + 3] === 0 ? 0 : 1
      const red = data[offset] * visible
      const green = data[offset + 1] * visible
      const blue = data[offset + 2] * visible
      lumaRow.push((red + green + blue) / 3)
      chromaRow.push(red - (green + blue) / 2)
    }
    luma.push(lumaRow)
    chroma.push(chromaRow)
  }

  return { luma, chroma }
}

export function buildRegistry(
  components: ComponentDescriptor[],
  patternSize = DEFAULT_PATTERN_SIZE,
  intensity = DEFAULT_INTENSITY,
): RegistryEntry[] {
  assertComponents(components)
  const sizes = components.map((component) =>
    Math.min(512, Math.max(16, resolvePatternSize(component, patternSize))),
  )
  const sampleCount = sizes.reduce((total, size) => total + size * size, 0)
  if (sampleCount > MAX_PATTERN_SAMPLES) {
    throw new RangeError('Registry patterns exceed the decoder memory budget')
  }
  return components.map((component, index) => ({
    ...component,
    pattern: generatePattern(
      createPatternPayload(component),
      sizes[index],
      intensity,
      component.patternVersion,
    ),
  }))
}

function groupRegistryByTileSize(
  registry: RegistryEntry[],
): Map<number, RegistryEntry[]> {
  const groups = new Map<number, RegistryEntry[]>()
  for (const entry of registry) {
    const tileSize = entry.pattern.length
    const batch = groups.get(tileSize)
    if (batch) batch.push(entry)
    else groups.set(tileSize, [entry])
  }
  return groups
}

function assertRegistry(registry: RegistryEntry[]): void {
  assertComponents(registry)
  let samples = 0
  for (const [index, entry] of registry.entries()) {
    const size = entry.pattern?.length
    if (!Array.isArray(entry.pattern) || size < 16 || size > 512) {
      throw new TypeError(`Invalid registry pattern at index ${index}`)
    }
    samples += size * size
  }
  if (samples > MAX_PATTERN_SAMPLES) {
    throw new RangeError('Registry patterns exceed the decoder memory budget')
  }
  for (const [index, entry] of registry.entries()) {
    for (const row of entry.pattern) {
      if (!Array.isArray(row) || row.length !== entry.pattern.length) {
        throw new TypeError(`Invalid registry pattern at index ${index}`)
      }
      for (const sample of row) {
        if (!Number.isFinite(sample)) {
          throw new TypeError(`Invalid registry pattern at index ${index}`)
        }
      }
    }
  }
}

function scanSampleCount(width: number, height: number, tileSize: number, step: number): number {
  const coarse = (Math.floor((width - tileSize) / step) + 1) *
    (Math.floor((height - tileSize) / step) + 1) * tileSize * tileSize
  const stride = Math.max(1, Math.floor(tileSize / 32))
  const refinement = Math.min(width - tileSize + 1, 2 * step + 1) *
    Math.min(height - tileSize + 1, 2 * step + 1) * Math.ceil(tileSize / stride) ** 2
  const fineStep = Math.max(1, Math.floor(step / 4))
  const dense = fineStep === step ? 0 :
    (Math.floor((width - tileSize) / fineStep) + 1) *
    (Math.floor((height - tileSize) / fineStep) + 1) * Math.ceil(tileSize / stride) ** 2
  return coarse + dense + 2 * (refinement + tileSize * tileSize)
}

function sampledPatchScore(data: Uint8Array, width: number, x: number, y: number, pattern: PatternMatrix): number {
  const stride = Math.max(1, Math.floor(pattern.length / 32))
  let lumaSum = 0, chromaSum = 0, expectedSum = 0
  let lumaSquareSum = 0, chromaSquareSum = 0, expectedSquareSum = 0
  let lumaProductSum = 0, chromaProductSum = 0, count = 0
  for (let row = 0; row < pattern.length; row += stride) {
    for (let column = 0; column < pattern.length; column += stride) {
      const offset = ((y + row) * width + x + column) * 4
      const visible = data[offset + 3] === 0 ? 0 : 1
      const red = data[offset] * visible
      const green = data[offset + 1] * visible
      const blue = data[offset + 2] * visible
      const luma = (red + green + blue) / 3
      const chroma = red - (green + blue) / 2
      const expected = pattern[row][column]
      lumaSum += luma
      chromaSum += chroma
      expectedSum += expected
      lumaSquareSum += luma * luma
      chromaSquareSum += chroma * chroma
      expectedSquareSum += expected * expected
      lumaProductSum += luma * expected
      chromaProductSum += chroma * expected
      count += 1
    }
  }
  const expectedVariance = Math.max(0, expectedSquareSum - expectedSum * expectedSum / count)
  const lumaDenominator = Math.sqrt(Math.max(0, lumaSquareSum - lumaSum * lumaSum / count) * expectedVariance)
  const chromaDenominator = Math.sqrt(Math.max(0, chromaSquareSum - chromaSum * chromaSum / count) * expectedVariance)
  return Math.max(
    lumaDenominator === 0 ? 0 : (lumaProductSum - lumaSum * expectedSum / count) / lumaDenominator,
    chromaDenominator === 0 ? 0 : (chromaProductSum - chromaSum * expectedSum / count) / chromaDenominator,
  )
}

function scanUniformTileSize(
  data: Uint8Array,
  width: number,
  height: number,
  registry: RegistryEntry[],
  options: ScanOptions,
): ScanResult[] {
  const tileSize = registry[0]?.pattern.length ?? 0
  if (tileSize === 0 || tileSize > 512 || width < tileSize || height < tileSize) {
    return []
  }

  const requestedThreshold = options.threshold ?? 0.7
  const threshold = Math.min(1, Math.max(-1, requestedThreshold))
  const requestedStep = options.step ?? tileSize / 8
  const step = Math.max(1, Math.round(requestedStep))
  const matches = new Map<string, ScanResult>()
  const candidates = new Map<RegistryEntry, { x: number; y: number; score: number }>()

  for (let y = 0; y <= height - tileSize; y += step) {
    for (let x = 0; x <= width - tileSize; x += step) {
      const tiles = extractTiles(data, width, height, x, y, tileSize)

      for (const entry of registry) {
        if (entry.pattern.length !== tileSize) {
          throw new TypeError('scanUniformTileSize requires a single tile size')
        }
        const score = Math.max(
          comparePatterns(tiles.luma, entry.pattern),
          comparePatterns(tiles.chroma, entry.pattern),
        )
        const best = candidates.get(entry)
        if (!best || score > best.score) candidates.set(entry, { x, y, score })
        if (score < threshold) continue

        const existing = matches.get(entry.path)
        if (existing) {
          existing.count += 1
          existing.score = Math.max(existing.score, score)
        } else {
          matches.set(entry.path, {
            path: entry.path,
            type: entry.type,
            depth: entry.depth,
            source: entry.source,
            score,
            count: 1,
            tileSize,
          })
        }
      }
    }
  }

  for (const [entry, coarseCandidate] of candidates) {
    const nominations = [coarseCandidate]
    const fineStep = Math.max(1, Math.floor(step / 4))
    if (fineStep < step) {
      let denseCandidate = { ...coarseCandidate, score: -Infinity }
      for (let y = 0; y <= height - tileSize; y += fineStep) {
        for (let x = 0; x <= width - tileSize; x += fineStep) {
          const score = sampledPatchScore(data, width, x, y, entry.pattern)
          if (score > denseCandidate.score) denseCandidate = { x, y, score }
        }
      }
      nominations.push(denseCandidate)
    }
    const confirmed = new Set<string>()
    for (const candidate of nominations) {
      let best = { ...candidate, score: -Infinity }
      for (let y = Math.max(0, candidate.y - step); y <= Math.min(height - tileSize, candidate.y + step); y++) {
        for (let x = Math.max(0, candidate.x - step); x <= Math.min(width - tileSize, candidate.x + step); x++) {
          const score = sampledPatchScore(data, width, x, y, entry.pattern)
          if (score > best.score) best = { x, y, score }
        }
      }
      // A sampled correlation only nominates a position; confirm all its pixels.
      const position = `${best.x},${best.y}`
      if ((best.x % step === 0 && best.y % step === 0) || confirmed.has(position)) continue
      confirmed.add(position)
      const tiles = extractTiles(data, width, height, best.x, best.y, tileSize)
      const score = Math.max(comparePatterns(tiles.luma, entry.pattern), comparePatterns(tiles.chroma, entry.pattern))
      if (score < threshold) continue
      const existing = matches.get(entry.path)
      if (existing) {
        existing.count += 1
        existing.score = Math.max(existing.score, score)
      } else {
        matches.set(entry.path, {
          path: entry.path, type: entry.type, depth: entry.depth, source: entry.source,
          score, count: 1, tileSize,
        })
      }
    }
  }

  return [...matches.values()]
}

export function scanPixels(
  data: Uint8Array,
  width: number,
  height: number,
  registry: RegistryEntry[],
  options: ScanOptions = {},
): ScanResult[] {
  assertScanOptions(options)
  if (registry.length === 0 || width <= 0 || height <= 0) return []
  assertRaster(data, width, height)
  assertRegistry(registry)
  const groups = groupRegistryByTileSize(registry)
  let correlationSamples = 0
  for (const [tileSize, batch] of groups) {
    if (tileSize > width || tileSize > height) continue
    const step = Math.max(1, Math.round(options.step ?? tileSize / 8))
    correlationSamples += scanSampleCount(width, height, tileSize, step) * batch.length
  }
  if (correlationSamples > MAX_CORRELATION_SAMPLES) {
    throw new RangeError(
      'Scan exceeds the decoder computation budget; increase step or narrow the registry',
    )
  }

  const threshold = options.threshold ?? 0.7
  const matches = new Map<string, ScanResult>()

  for (const batch of groups.values()) {
    for (const result of scanUniformTileSize(data, width, height, batch, options)) {
      const existing = matches.get(result.path)
      if (
        !existing ||
        result.score > existing.score ||
        (result.score === existing.score && result.count > existing.count)
      ) {
        matches.set(result.path, result)
      }
    }
  }

  return rankByHierarchy([...matches.values()], {
    threshold,
    margin: HIERARCHY_SCORE_MARGIN,
  })
}

export function scanPng(
  pngData: Uint8Array,
  registry: RegistryEntry[],
  options: ScanOptions = {},
): ScanResult[] {
  const png = readPng(pngData)
  return scanPixels(png.data, png.width, png.height, registry, options)
}

/** @deprecated Use `buildRegistry`. */
export const build = buildRegistry

/** @deprecated Use `scanPng` with a ScanOptions object. */
export function scan(
  pngData: Uint8Array,
  registry: RegistryEntry[],
  tileSize = DEFAULT_PATTERN_SIZE,
  threshold = 0.7,
): ScanResult[] {
  return scanPng(pngData, registry, {
    threshold,
    step: Math.max(1, Math.round(tileSize / 2)),
  })
}

export { generatePattern }

export function decodePng(
  pngData: Uint8Array,
  components: ComponentDescriptor[],
  options: DecodeOptions = {},
): ScanResult[] {
  assertScanOptions(options)
  const baseSize = options.patternSize ?? DEFAULT_PATTERN_SIZE
  const intensity = options.intensity ?? DEFAULT_INTENSITY
  const scales = options.scales?.length ? options.scales : [1, 2]
  const merged = new Map<string, ScanResult>()

  assertComponents(components)
  if (scales.length > MAX_SCALES) {
    throw new RangeError(`At most ${MAX_SCALES} screenshot scales can be checked at once`)
  }

  const png = readPng(pngData)
  const threshold = options.threshold ?? defaultThreshold(components)
  // v2 and v3 are both spectral-detected but read different channels:
  // v2 → chroma (R−(G+B)/2), v3 → luma ((R+G+B)/3). v3's luma path
  // survives JPEG 4:2:0 chroma subsampling, which destroys v2.
  const spectralComponents = components.filter(isV2)
  const spectralV3Components = components.filter(isV3)
  const scannedComponents = components.filter((component) => !isV2(component) && !isV3(component))

  let totalCorrelationSamples = 0
  for (const scale of scales) {
    if (!Number.isFinite(scale) || scale < 0.25 || scale > 2) {
      throw new RangeError('Screenshot scales must be between 0.25 and 2')
    }
    const spectralSizes = new Map<number, number>()
    for (const component of spectralComponents) {
      const tileSize = Math.round(resolvePatternSize(component, baseSize) * scale)
      if (tileSize < 16 || tileSize > 512 || png.width < tileSize || png.height < tileSize) continue
      spectralSizes.set(tileSize, (spectralSizes.get(tileSize) ?? 0) + 1)
    }
    const spectralV3Sizes = new Map<number, number>()
    for (const component of spectralV3Components) {
      const tileSize = Math.round(resolvePatternSize(component, baseSize) * scale)
      if (tileSize < 16 || tileSize > 512 || png.width < tileSize || png.height < tileSize) continue
      spectralV3Sizes.set(tileSize, (spectralV3Sizes.get(tileSize) ?? 0) + 1)
    }
    for (const [tileSize, count] of spectralSizes) {
      totalCorrelationSamples += spectralCost(png.width, png.height, tileSize, count, 'sliding')
    }
    for (const [tileSize, count] of spectralV3Sizes) {
      totalCorrelationSamples += spectralCost(png.width, png.height, tileSize, count, 'sliding')
    }
    for (const component of scannedComponents) {
      const componentBase = resolvePatternSize(component, baseSize)
      const tileSize = Math.round(componentBase * scale)
      if (tileSize < 16 || tileSize > 512 || png.width < tileSize || png.height < tileSize) {
        continue
      }
      const requestedStep = options.step !== undefined ? options.step * scale : tileSize / 8
      if (!Number.isFinite(requestedStep) || requestedStep <= 0) {
        throw new RangeError('Scan step must be a positive finite number')
      }
      const step = Math.max(1, Math.round(requestedStep))
      totalCorrelationSamples += scanSampleCount(png.width, png.height, tileSize, step)
    }
  }
  if (totalCorrelationSamples > MAX_CORRELATION_SAMPLES) {
    throw new RangeError(
      'Scan exceeds the decoder computation budget; increase step, reduce scales, or narrow the registry',
    )
  }

  const keep = (result: ScanResult) => {
    const existing = merged.get(result.path)
    if (
      !existing ||
      result.score > existing.score ||
      (result.score === existing.score && result.count > existing.count) ||
      (result.score === existing.score &&
        result.count === existing.count &&
        result.tileSize < existing.tileSize)
    ) {
      merged.set(result.path, result)
    }
  }

  // v2: shift-invariant spectral detection in sliding 2T windows (chroma).
  for (const scale of scales) {
    const bySize = new Map<number, ComponentDescriptor[]>()
    for (const component of spectralComponents) {
      const tileSize = Math.round(resolvePatternSize(component, baseSize) * scale)
      if (tileSize < 16 || tileSize > 512 || png.width < tileSize || png.height < tileSize) continue
      bySize.set(tileSize, [...(bySize.get(tileSize) ?? []), component])
    }
    for (const [tileSize, batch] of bySize) {
      const results = detectSpectral(png.data, png.width, png.height, tileSize, batch.map((component) => {
        const payload = createPatternPayload(component)
        return { waves: patternWaves(payload), pattern: generatePattern(payload, tileSize, intensity, 2) }
      }), { mode: 'sliding', threshold, channel: 'chroma' })
      batch.forEach((component, index) => {
        if (results[index].score < threshold) return
        keep({ ...component, score: results[index].score, count: results[index].count, tileSize })
      })
    }
  }

  // v3: same shape, luma channel. Survives JPEG 4:2:0 subsampling.
  for (const scale of scales) {
    const bySize = new Map<number, ComponentDescriptor[]>()
    for (const component of spectralV3Components) {
      const tileSize = Math.round(resolvePatternSize(component, baseSize) * scale)
      if (tileSize < 16 || tileSize > 512 || png.width < tileSize || png.height < tileSize) continue
      bySize.set(tileSize, [...(bySize.get(tileSize) ?? []), component])
    }
    for (const [tileSize, batch] of bySize) {
      const results = detectSpectral(png.data, png.width, png.height, tileSize, batch.map((component) => {
        const payload = createPatternPayload(component)
        return { waves: patternWaves(payload), pattern: generatePattern(payload, tileSize, intensity, 3) }
      }), { mode: 'sliding', threshold, channel: 'luma' })
      batch.forEach((component, index) => {
        if (results[index].score < threshold) return
        keep({ ...component, score: results[index].score, count: results[index].count, tileSize })
      })
    }
  }

  for (const scale of scales) {
    // Group by effective 1× size so mixed hierarchy tiles stay uniform per batch.
    const byBaseSize = new Map<number, ComponentDescriptor[]>()
    for (const component of scannedComponents) {
      const componentBase = resolvePatternSize(component, baseSize)
      const batch = byBaseSize.get(componentBase)
      if (batch) batch.push(component)
      else byBaseSize.set(componentBase, [component])
    }

    for (const [componentBase, batchComponents] of byBaseSize) {
      const tileSize = Math.round(componentBase * scale)
      if (tileSize < 16 || tileSize > 512 || png.width < tileSize || png.height < tileSize) {
        continue
      }
      const batchSize = Math.max(
        1,
        Math.floor(MAX_PATTERN_SAMPLES / (tileSize * tileSize)),
      )

      for (let start = 0; start < batchComponents.length; start += batchSize) {
        // Descriptors retain their CSS size; only the generated raster is scaled.
        const registry: RegistryEntry[] = batchComponents
          .slice(start, start + batchSize)
          .map((component) => ({
            ...component,
            pattern: generatePattern(createPatternPayload(component), tileSize, intensity, component.patternVersion),
          }))
        const results = scanPixels(png.data, png.width, png.height, registry, {
          threshold: options.threshold,
          step: options.step !== undefined ? options.step * scale : undefined,
        })

        for (const result of results) keep(result)
      }
    }
  }

  return rankByHierarchy([...merged.values()], {
    threshold,
    margin: HIERARCHY_SCORE_MARGIN,
  })
}

function readComponents(registryPath: string): ComponentDescriptor[] {
  if (statSync(registryPath).size > MAX_REGISTRY_BYTES) {
    throw new RangeError(`Registry exceeds the ${MAX_REGISTRY_BYTES / 1024} KB input limit`)
  }
  const parsed: unknown = JSON.parse(readFileSync(registryPath, 'utf8'))
  const components = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && 'components' in parsed
      ? (parsed as { components: unknown }).components
      : null

  if (!Array.isArray(components)) {
    throw new Error('Registry must be an array or an object with a components array')
  }

  const descriptors = components.map((component, index) => {
    if (
      typeof component !== 'object' ||
      component === null ||
      !('path' in component) ||
      !('type' in component) ||
      !('depth' in component) ||
      typeof component.path !== 'string' ||
      typeof component.type !== 'string' ||
      typeof component.depth !== 'number'
    ) {
      throw new Error(`Invalid component at registry index ${index}`)
    }

    const sourceValue = 'source' in component ? component.source : undefined
    const source = sourceValue === undefined
      ? undefined
      : typeof sourceValue === 'object' &&
          sourceValue !== null &&
          'file' in sourceValue &&
          'line' in sourceValue &&
          'column' in sourceValue &&
          typeof sourceValue.file === 'string' &&
          typeof sourceValue.line === 'number' &&
          typeof sourceValue.column === 'number'
        ? {
            file: sourceValue.file,
            line: sourceValue.line,
            column: sourceValue.column,
          }
        : null

    if (source === null) {
      throw new Error(`Invalid source mapping at registry index ${index}`)
    }

    const patternSizeValue =
      'patternSize' in component ? component.patternSize : undefined
    const patternSize =
      patternSizeValue === undefined
        ? undefined
        : typeof patternSizeValue === 'number' &&
            Number.isFinite(patternSizeValue)
          ? patternSizeValue
          : null

    if (patternSize === null) {
      throw new Error(`Invalid patternSize at registry index ${index}`)
    }

    const patternVersionValue =
      'patternVersion' in component ? component.patternVersion : undefined
    if (patternVersionValue !== undefined && patternVersionValue !== 1 && patternVersionValue !== 2) {
      throw new Error(`Invalid patternVersion at registry index ${index}`)
    }

    return {
      path: component.path,
      type: component.type,
      depth: component.depth,
      source,
      patternSize,
      ...(patternVersionValue !== undefined ? { patternVersion: patternVersionValue } : {}),
    }
  })

  assertComponents(descriptors)
  return descriptors
}

interface CliOptions {
  imagePath: string
  registryPath: string
  threshold?: number
  patternSize?: number
  intensity?: number
  scales?: number[]
  step?: number
  patternVersion?: PatternVersion
  json: boolean
}

const CLI_USAGE = 'Usage: pixelprovenance-decode <image.png> --registry <components.json> [--threshold 0.5 (v2/v3) | 0.7 (v1)] [--pattern-size 64] [--intensity 0.12] [--scale auto|1|2] [--step pixels] [--pattern-version 1|2|3] [--json]'

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function parseNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${flag} must be a finite number`)
  return parsed
}

function parseCli(args: string[]): CliOptions {
  const valueFlags = new Set([
    '--registry',
    '--threshold',
    '--pattern-size',
    '--intensity',
    '--scale',
    '--step',
    '--pattern-version',
  ])
  const positional: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--json') continue
    if (!argument.startsWith('--')) {
      positional.push(argument)
      continue
    }
    if (!valueFlags.has(argument)) throw new Error(`Unknown option: ${argument}`)
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`)
    index += 1
  }

  const imagePath = positional.length === 1 ? positional[0] : undefined
  const registryPath = readFlag(args, '--registry')

  if (!imagePath || !registryPath) {
    throw new Error(
      CLI_USAGE,
    )
  }

  const scaleValue = readFlag(args, '--scale')
  const scales = !scaleValue || scaleValue === 'auto'
    ? [1, 2]
    : [parseNumber(scaleValue, '--scale') as number]

  return {
    imagePath,
    registryPath,
    threshold: parseNumber(readFlag(args, '--threshold'), '--threshold'),
    patternSize: parseNumber(readFlag(args, '--pattern-size'), '--pattern-size'),
    intensity: parseNumber(readFlag(args, '--intensity'), '--intensity'),
    scales,
    step: parseNumber(readFlag(args, '--step'), '--step'),
    patternVersion: parsePatternVersion(readFlag(args, '--pattern-version')),
    json: args.includes('--json'),
  }
}

function parsePatternVersion(value: string | undefined): PatternVersion | undefined {
  if (value === undefined) return undefined
  if (value === '1' || value === '2' || value === '3') return Number(value) as PatternVersion
  throw new Error('--pattern-version must be 1, 2, or 3')
}

function runCli(args: string[]): number {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(CLI_USAGE)
    return 0
  }
  try {
    const options = parseCli(args)
    if (!existsSync(options.imagePath)) throw new Error(`Image not found: ${options.imagePath}`)
    if (!existsSync(options.registryPath)) throw new Error(`Registry not found: ${options.registryPath}`)
    if (statSync(options.imagePath).size > MAX_IMAGE_BYTES) {
      throw new Error(`PNG exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024} MB input limit`)
    }

    // Entries without their own patternVersion use the CLI flag (legacy v1 screenshots).
    const components = readComponents(options.registryPath).map((component) =>
      component.patternVersion === undefined && options.patternVersion !== undefined
        ? { ...component, patternVersion: options.patternVersion }
        : component,
    )
    const results = decodePng(readFileSync(options.imagePath), components, options)

    if (options.json) {
      console.log(JSON.stringify(results, null, 2))
      return results.length === 0 ? 1 : 0
    }

    if (results.length === 0) {
      console.log('No matching PixelProvenance signals found.')
      return 1
    }

    console.log(`Found ${results.length} component signal${results.length === 1 ? '' : 's'}:`)
    for (const result of results) {
      const source = result.source
        ? ` -> ${result.source.file}:${result.source.line}:${result.source.column}`
        : ''
      console.log(
        `  ${result.path} (${result.type}, ${(result.score * 100).toFixed(1)}% match, ${result.tileSize}px tile)${source}`,
      )
    }
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

const entryPath = process.argv[1]
if (
  entryPath &&
  existsSync(entryPath) &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entryPath)
) {
  process.exitCode = runCli(process.argv.slice(2))
}
