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

function makePng(tileSize: number, scale = 1, actualAlpha = false): Buffer {
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
      const alpha = actualAlpha ? tile[sourceOffset + 3] / 255 : 0.3
      for (let channel = 0; channel < 3; channel += 1) {
        png.data[targetOffset + channel] = Math.round(
          tile[sourceOffset + channel] * alpha + 220 * (1 - alpha),
        )
      }
      png.data[targetOffset + 3] = 255
    }
  }

  return PNG.sync.write(png)
}

describe('screenshot decoder', () => {
  it('searches beyond a misleading coarse correlation peak', () => {
    const component = { path: 'BENCH/card', type: 'card', depth: 2 }
    const tile = generatePatternRgba(createPatternPayload(component), 64, 0.08)
    const png = new PNG({ width: 256, height: 320 })
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const source = ((Math.floor((y + 11) / 2) % 64) * 64 + Math.floor((x + 19) / 2) % 64) * 4
        const offset = (y * png.width + x) * 4
        for (let channel = 0; channel < 3; channel++) {
          png.data[offset + channel] = Math.round(224 * (1 - 3 / 255) + tile[source + channel] * 3 / 255)
        }
        png.data[offset + 3] = 255
      }
    }
    expect(decodePng(PNG.sync.write(png), [component])[0])
      .toMatchObject({ path: component.path, tileSize: 128 })
  })
  it('does not identify a signal hidden in fully transparent PNG pixels', () => {
    const png = new PNG({ width: 64, height: 64 })
    png.data.set(generatePatternRgba(createPatternPayload(TARGET), 64, 0.16))
    for (let offset = 3; offset < png.data.length; offset += 4) png.data[offset] = 0
    expect(decodePng(PNG.sync.write(png), [TARGET], { intensity: 0.16 })).toEqual([])
  })
  it.each([1, 2])('recovers an off-grid crop at %dx', (scale) => {
    const original = PNG.sync.read(makePng(64, scale, true))
    const cropped = new PNG({ width: original.width - 7, height: original.height - 11 })
    PNG.bitblt(original, cropped, 7, 11, cropped.width, cropped.height, 0, 0)
    const results = decodePng(PNG.sync.write(cropped), [TARGET, DECOY], { intensity: 0.16 })
    expect(results[0]).toMatchObject({ path: TARGET.path, tileSize: 64 * scale })
  })
  it.each([1, 2])('recovers the actual browser-opacity carrier at %dx', (scale) => {
    const results = decodePng(makePng(64, scale, true), [TARGET, DECOY], {
      intensity: 0.16,
    })
    expect(results[0]).toMatchObject({ path: TARGET.path, tileSize: 64 * scale })
  })
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

  it('decodes the largest supported CSS tile at 2x', () => {
    const results = decodePng(makePng(256, 2), [{ ...TARGET, patternSize: 256 }], {
      intensity: 0.16,
      threshold: 0.8,
      scales: [2],
    })

    expect(results[0]).toMatchObject({ path: TARGET.path, tileSize: 512 })
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

  it.each([0, Number.NaN, -1, Number.POSITIVE_INFINITY])(
    'rejects invalid decode step %s even when no tile fits', (step) => {
      expect(() => decodePng(makePng(16), [TARGET], { step, patternSize: 256 }))
        .toThrow(/positive finite/)
    },
  )

  it('rounds a scaled fractional step to at least one pixel', () => {
    const results = decodePng(makePng(16), [TARGET], {
      patternSize: 32,
      intensity: 0.16,
      scales: [0.5],
      step: 0.1,
    })
    expect(results[0]).toMatchObject({ path: TARGET.path, tileSize: 16 })
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

  it('checks the combined budget for mixed tile sizes before reading pixels', () => {
    const components = Array.from({ length: 240 }, (_, index) => ({
      path: `component-${index}`,
      type: 'component',
      depth: 1,
      patternSize: index < 120 ? 16 : 32,
    }))
    // Each group fits separately (122M and 457M samples), but their sum does not.
    const pixels = new Proxy(new Uint8Array(512 * 512 * 4), {
      get(target, property) {
        if (typeof property === 'string' && /^\d+$/.test(property)) {
          throw new Error('Read pixels before checking the combined budget')
        }
        return Reflect.get(target, property, target)
      },
    })
    expect(() => scanPixels(pixels, 512, 512, buildRegistry(components), { step: 8 }))
      .toThrow(/computation budget/)
  })

  it.each(['ragged', 'NaN', 'infinite', 'sparse'])('rejects a %s registry pattern', (kind) => {
    const registry = buildRegistry([TARGET], 16)
    if (kind === 'ragged') registry[0].pattern[3].pop()
    else if (kind === 'sparse') delete registry[0].pattern[3][4]
    else registry[0].pattern[3][4] = kind === 'NaN' ? Number.NaN : Infinity

    expect(() => scanPixels(new Uint8Array(16 * 16 * 4), 16, 16, registry))
      .toThrow(/Invalid registry pattern/)
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
