#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { PNG } from 'pngjs'

import {
  DEFAULT_INTENSITY,
  DEFAULT_PATTERN_SIZE,
  HIERARCHY_SCORE_MARGIN,
  comparePatterns,
  createPatternPayload,
  generatePattern,
  rankByHierarchy,
  resolvePatternSize,
  type ComponentDescriptor,
  type PatternMatrix,
} from '../src/pattern.js'

const MAX_IMAGE_BYTES = 100 * 1024 * 1024
const MAX_IMAGE_PIXELS = 25_000_000
const MAX_REGISTRY_BYTES = 1024 * 1024
const MAX_REGISTRY_ENTRIES = 512
const MAX_SCALES = 4
const MAX_PATTERN_SAMPLES = 4_000_000
const MAX_CORRELATION_SAMPLES = 500_000_000

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
          component.patternSize > 256))
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
      const red = data[offset]
      const green = data[offset + 1]
      const blue = data[offset + 2]
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
  if (!Number.isFinite(requestedThreshold)) {
    throw new RangeError('Scan threshold must be a finite number')
  }
  const threshold = Math.min(1, Math.max(-1, requestedThreshold))
  const requestedStep = options.step ?? tileSize / 2
  if (!Number.isFinite(requestedStep) || requestedStep <= 0) {
    throw new RangeError('Scan step must be a positive finite number')
  }
  const step = Math.max(1, Math.round(requestedStep))
  const horizontalPositions = Math.floor((width - tileSize) / step) + 1
  const verticalPositions = Math.floor((height - tileSize) / step) + 1
  const correlationSamples =
    horizontalPositions *
    verticalPositions *
    registry.length *
    tileSize *
    tileSize
  if (correlationSamples > MAX_CORRELATION_SAMPLES) {
    throw new RangeError(
      'Scan exceeds the decoder computation budget; increase step or narrow the registry',
    )
  }
  const matches = new Map<string, ScanResult>()

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

  return [...matches.values()]
}

export function scanPixels(
  data: Uint8Array,
  width: number,
  height: number,
  registry: RegistryEntry[],
  options: ScanOptions = {},
): ScanResult[] {
  if (registry.length === 0 || width <= 0 || height <= 0) return []
  assertRaster(data, width, height)
  if (registry.length > MAX_REGISTRY_ENTRIES) {
    throw new RangeError(`Registry exceeds the ${MAX_REGISTRY_ENTRIES} component limit`)
  }

  const threshold = options.threshold ?? 0.7
  const matches = new Map<string, ScanResult>()

  for (const batch of groupRegistryByTileSize(registry).values()) {
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
  const baseSize = options.patternSize ?? DEFAULT_PATTERN_SIZE
  const intensity = options.intensity ?? DEFAULT_INTENSITY
  const scales = options.scales?.length ? options.scales : [1, 2]
  const merged = new Map<string, ScanResult>()

  assertComponents(components)
  if (scales.length > MAX_SCALES) {
    throw new RangeError(`At most ${MAX_SCALES} screenshot scales can be checked at once`)
  }

  const png = readPng(pngData)

  let totalCorrelationSamples = 0
  for (const scale of scales) {
    if (!Number.isFinite(scale) || scale < 0.25 || scale > 2) {
      throw new RangeError('Screenshot scales must be between 0.25 and 2')
    }
    for (const component of components) {
      const componentBase = resolvePatternSize(component, baseSize)
      const tileSize = Math.round(componentBase * scale)
      if (tileSize < 16 || tileSize > 512 || png.width < tileSize || png.height < tileSize) {
        continue
      }
      const requestedStep = options.step ? options.step * scale : tileSize / 2
      if (!Number.isFinite(requestedStep) || requestedStep <= 0) {
        throw new RangeError('Scan step must be a positive finite number')
      }
      const step = Math.max(1, Math.round(requestedStep))
      const horizontalPositions = Math.floor((png.width - tileSize) / step) + 1
      const verticalPositions = Math.floor((png.height - tileSize) / step) + 1
      totalCorrelationSamples +=
        horizontalPositions * verticalPositions * tileSize * tileSize
    }
  }
  if (totalCorrelationSamples > MAX_CORRELATION_SAMPLES) {
    throw new RangeError(
      'Scan exceeds the decoder computation budget; increase step, reduce scales, or narrow the registry',
    )
  }

  for (const scale of scales) {
    // Group by effective 1× size so mixed hierarchy tiles stay uniform per batch.
    const byBaseSize = new Map<number, ComponentDescriptor[]>()
    for (const component of components) {
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
        // Force this scale's tile size for the batch (overrides per-entry 1× size).
        const registry = buildRegistry(
          batchComponents.slice(start, start + batchSize).map((component) => ({
            ...component,
            patternSize: tileSize,
          })),
          tileSize,
          intensity,
        )
        const results = scanPixels(png.data, png.width, png.height, registry, {
          threshold: options.threshold,
          step: options.step ? Math.round(options.step * scale) : undefined,
        })

        for (const result of results) {
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
      }
    }
  }

  return rankByHierarchy([...merged.values()], {
    threshold: options.threshold ?? 0.7,
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

    return {
      path: component.path,
      type: component.type,
      depth: component.depth,
      source,
      patternSize,
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
}

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
  ])
  const positional: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
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
      'Usage: pixelprovenance-decode <image.png> --registry <components.json> [--threshold 0.7] [--pattern-size 64] [--intensity 0.12] [--scale auto|1|2]',
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
  }
}

function runCli(args: string[]): number {
  try {
    const options = parseCli(args)
    if (!existsSync(options.imagePath)) throw new Error(`Image not found: ${options.imagePath}`)
    if (!existsSync(options.registryPath)) throw new Error(`Registry not found: ${options.registryPath}`)
    if (statSync(options.imagePath).size > MAX_IMAGE_BYTES) {
      throw new Error(`PNG exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024} MB input limit`)
    }

    const components = readComponents(options.registryPath)
    const results = decodePng(readFileSync(options.imagePath), components, options)

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
