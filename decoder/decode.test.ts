import { Buffer } from 'node:buffer'

import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import {
  build,
  buildRegistry,
  decodePng,
  scan,
  scanPixels,
} from './decode.js'
import {
  createPatternPayload,
  generatePatternRgba,
  type ComponentDescriptor,
} from '../src/pattern.js'

const TARGET: ComponentDescriptor = {
  path: 'LAB_DASHBOARD/evidence-feed/capture-PP-1042',
  type: 'capture',
  depth: 3,
  source: {
    file: 'src/features/evidence/CaptureCard.tsx',
    line: 47,
    column: 9,
  },
}

const DECOY: ComponentDescriptor = {
  path: 'LAB_DASHBOARD/inspection-panel',
  type: 'panel',
  depth: 2,
}

function makePng(tileSize: number, scale = 1): Buffer {
  const renderedTileSize = tileSize * scale
  const png = new PNG({ width: renderedTileSize * 2, height: renderedTileSize * 4 })
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = 96
    png.data[offset + 1] = 96
    png.data[offset + 2] = 96
    png.data[offset + 3] = 255
  }

  const tile = generatePatternRgba(
    createPatternPayload(TARGET),
    tileSize,
    0.16,
  )

  for (let y = renderedTileSize * 2; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const sourceX = Math.floor((x % renderedTileSize) / scale)
      const sourceY = Math.floor((y % renderedTileSize) / scale)
      const sourceOffset = (sourceY * tileSize + sourceX) * 4
      const targetOffset = (y * png.width + x) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        png.data[targetOffset + channel] = Math.round(
          tile[sourceOffset + channel] * 0.3 + 220 * 0.7,
        )
      }
      png.data[targetOffset + 3] = 255
    }
  }

  return PNG.sync.write(png)
}

describe('screenshot decoder', () => {
  it('finds a registered pattern in the lower half of a non-square image', () => {
    const png = PNG.sync.read(makePng(32))
    const registry = buildRegistry([TARGET, DECOY], 32, 0.16)
    const results = scanPixels(png.data, png.width, png.height, registry, {
      threshold: 0.95,
      step: 32,
    })

    expect(results[0]).toMatchObject({
      path: TARGET.path,
      tileSize: 32,
      source: TARGET.source,
    })
    expect(results.some((result) => result.path === DECOY.path)).toBe(false)
  })

  it('auto-detects a 2x screenshot scale', () => {
    const results = decodePng(makePng(64, 2), [TARGET, DECOY], {
      patternSize: 64,
      intensity: 0.16,
      threshold: 0.8,
      scales: [1, 2],
    })

    expect(results[0]).toMatchObject({ path: TARGET.path, tileSize: 128 })
    expect(results[0].score).toBeGreaterThan(0.8)
  })

  it('supports the default decoder path and compatibility aliases', () => {
    const image = makePng(64)
    const registry = build([TARGET, DECOY], 64, 0.16)

    expect(build).toBe(buildRegistry)
    expect(scan(image, registry)[0].path).toBe(TARGET.path)
    expect(decodePng(image, [TARGET, DECOY])[0].path).toBe(TARGET.path)
  })

  it('rejects invalid and unbounded pixel dimensions', () => {
    expect(() =>
      scanPixels(new Uint8Array(4), Number.POSITIVE_INFINITY, 1, buildRegistry([TARGET])),
    ).toThrow(/positive safe integers/)
  })

  it('rejects invalid scan controls before entering the scan loop', () => {
    const registry = buildRegistry([TARGET])
    const pixels = new Uint8Array(64 * 64 * 4)

    expect(() =>
      scanPixels(pixels, 64, 64, registry, { step: Number.NaN }),
    ).toThrow(/positive finite/)
    expect(() =>
      scanPixels(pixels, 64, 64, registry, { threshold: Number.POSITIVE_INFINITY }),
    ).toThrow(/finite number/)
  })

  it('batches a large registry at 2x without exceeding pattern memory', () => {
    const components = Array.from({ length: 250 }, (_, index) => ({
      path: `component-${index}`,
      type: 'component',
      depth: 1,
    }))
    const png = new PNG({ width: 128, height: 128 })
    png.data.fill(255)

    expect(
      decodePng(PNG.sync.write(png), components, {
        patternSize: 64,
        scales: [2],
        threshold: 1,
      }),
    ).toEqual([])
  })

  it('rejects scans that exceed the aggregate computation budget', () => {
    const components = Array.from({ length: 512 }, (_, index) => ({
      path: `component-${index}`,
      type: 'component',
      depth: 1,
    }))
    const pixels = new Uint8Array(512 * 512 * 4)

    expect(() =>
      scanPixels(pixels, 512, 512, buildRegistry(components, 16), { step: 1 }),
    ).toThrow(/computation budget/)
  })

  it('rejects interlaced PNG input before decompression', () => {
    const interlacedHeader = Buffer.alloc(29)
    interlacedHeader.write('IHDR', 12, 'ascii')
    interlacedHeader.writeUInt32BE(1, 16)
    interlacedHeader.writeUInt32BE(1, 20)
    interlacedHeader[28] = 1

    expect(() => decodePng(interlacedHeader, [TARGET], { scales: [1] }))
      .toThrow(/Interlaced PNG/)
  })
})
