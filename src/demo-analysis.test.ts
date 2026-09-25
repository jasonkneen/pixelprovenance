import { describe, expect, it } from 'vitest'

import { analyzeScreenshot } from './demo-analysis.js'
import {
  createPatternPayload,
  generatePatternRgba,
  type ComponentDescriptor,
} from './pattern.js'

const TARGET: ComponentDescriptor = {
  path: 'SAMPLE_APP/focus-card',
  type: 'card',
  depth: 2,
  source: {
    file: 'src/features/dashboard/FocusCard.tsx',
    line: 41,
    column: 5,
  },
}

const DECOY: ComponentDescriptor = {
  path: 'SAMPLE_APP/activity-feed',
  type: 'panel',
  depth: 2,
  source: {
    file: 'src/features/dashboard/ActivityFeed.tsx',
    line: 18,
    column: 3,
  },
}

describe('browser analysis limits', () => {
  it('recovers a heading from a tight crop with an overlapping parent signal', () => {
    const parent = { path: 'MORROW_DASHBOARD/sprint-overview', type: 'project-card', depth: 2,
      source: { file: 'src/features/dashboard/SprintOverview.tsx', line: 41, column: 5 } }
    const heading = { path: parent.path + '/title', type: 'heading', depth: 3, patternSize: 32,
      source: { ...parent.source, line: 45, column: 9 } }
    const parentTile = generatePatternRgba(createPatternPayload(parent), 64, 0.08)
    const titleTile = generatePatternRgba(createPatternPayload(heading), 32, 0.08)
    const width = 64, height = 48
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const parentOffset = (((y + 11) % 64) * 64 + (x + 7) % 64) * 4
      const titleOffset = (((y + 3) % 32) * 32 + (x + 5) % 32) * 4
      for (let c = 0; c < 3; c++) {
        const background = 224 * (1 - 3 / 255) + parentTile[parentOffset + c] * 3 / 255
        data[offset + c] = Math.round(background * (1 - 3 / 255) + titleTile[titleOffset + c] * 3 / 255)
      }
      data[offset + 3] = 255
    }
    const results = analyzeScreenshot(data, width, height, [parent, heading], { scales: [1], threshold: 0.42 })
    expect(results[0].component.path).toBe(heading.path)
    expect(results[0].score).toBeGreaterThan(0.42)
  })
  it('does not identify RGB data hidden under zero alpha', () => {
    const data = generatePatternRgba(createPatternPayload(TARGET), 64, 0.08)
    for (let offset = 3; offset < data.length; offset += 4) data[offset] = 0
    const results = analyzeScreenshot(data, 64, 64, [TARGET], { scales: [1] })
    expect(results[0].score).toBe(0)
  })
  it.each([0, -1, NaN, Infinity])('rejects invalid step %s', (step) => {
    expect(() => analyzeScreenshot(new Uint8ClampedArray(16 * 16 * 4), 16, 16, [TARGET], { step }))
      .toThrow(/step/)
  })

  it.each([1, 1024])('rejects excessive v1 scan or refinement work at step %s before reading pixels', (step) => {
    const pixels = new Proxy(new Uint8ClampedArray(1024 * 1024 * 4), {
      get(target, property) {
        if (typeof property === 'string' && /^\d+$/.test(property)) {
          throw new Error('Read pixels before checking the budget')
        }
        return Reflect.get(target, property, target)
      },
    })
    expect(() => analyzeScreenshot(pixels, 1024, 1024, [{ ...TARGET, patternVersion: 1 }], { step }))
      .toThrow(/computation budget/)
  })

  it('recovers a 256px CSS tile from a 2x capture', () => {
    const component = { ...TARGET, patternSize: 256 }
    const tile = generatePatternRgba(createPatternPayload(component), 256, 0.08)
    const data = new Uint8ClampedArray(512 * 512 * 4)
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const source = (Math.floor(y / 2) * 256 + Math.floor(x / 2)) * 4
        const destination = (y * 512 + x) * 4
        const alpha = tile[source + 3] / 255
        for (let channel = 0; channel < 3; channel++) {
          data[destination + channel] = Math.round(224 * (1 - alpha) + tile[source + channel] * alpha)
        }
        data[destination + 3] = 255
      }
    }
    const results = analyzeScreenshot(data, 512, 512, [component], { scales: [2] })
    expect(results[0].tileSize).toBe(512)
    expect(results[0].score).toBeGreaterThan(0.7)
  })
})

function makeCapturedCrop(): {
  data: Uint8ClampedArray
  width: number
  height: number
} {
  const width = 236
  const height = 164
  const data = new Uint8ClampedArray(width * height * 4)
  const tile = generatePatternRgba(createPatternPayload(TARGET), 64, 0.08)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const insideTarget = x >= 29 && x < 221 && y >= 21 && y < 149
      const background = insideTarget ? 224 : 246
      const alpha = insideTarget ? 3 / 255 : 0
      const tileOffset = (((y - 21) % 64) * 64 + ((x - 29) % 64)) * 4

      for (let channel = 0; channel < 3; channel += 1) {
        const signal = insideTarget ? tile[tileOffset + channel] : background
        data[offset + channel] = Math.round(
          background * (1 - alpha) + signal * alpha,
        )
      }
      data[offset + 3] = 255
    }
  }

  return { data, width, height }
}

function makeBusyEdgeCrop(encoded = true, scale = 1): {
  data: Uint8ClampedArray
  width: number
  height: number
} {
  const width = 163 * scale
  const height = 93 * scale
  const cardLeft = 29 * scale
  const cardBottom = 85 * scale
  const patternSize = 64
  const renderedPatternSize = patternSize * scale
  const data = new Uint8ClampedArray(width * height * 4)
  const tile = generatePatternRgba(
    createPatternPayload(TARGET),
    patternSize,
    0.08,
  )
  const avatars = [
    { x: 68 * scale, color: [255, 255, 255] },
    { x: 98 * scale, color: [255, 174, 155] },
    { x: 128 * scale, color: [82, 101, 255] },
  ]

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      let base = x < cardLeft || y >= cardBottom
        ? [248, 247, 243]
        : [227, 224, 255]

      for (const avatar of avatars) {
        if (
          (x - avatar.x) ** 2 + (y - 55 * scale) ** 2 <=
          (14 * scale) ** 2
        ) {
          base = avatar.color
        }
      }

      const insideSignal = x >= cardLeft && y < cardBottom
      const renderedTileX =
        ((x - cardLeft) % renderedPatternSize + renderedPatternSize) %
        renderedPatternSize
      const renderedTileY = (y + 205 * scale) % renderedPatternSize
      const tileX = Math.floor(renderedTileX / scale)
      const tileY = Math.floor(renderedTileY / scale)
      const tileOffset = (tileY * patternSize + tileX) * 4
      const alpha = insideSignal && encoded ? tile[tileOffset + 3] / 255 : 0
      for (let channel = 0; channel < 3; channel += 1) {
        data[offset + channel] = Math.round(
          base[channel] * (1 - alpha) + tile[tileOffset + channel] * alpha,
        )
      }
      data[offset + 3] = 255
    }
  }

  // The capture target outline sits above the signal layer in the demo.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (
        (x >= 27 * scale && x <= 30 * scale) ||
        (y >= 84 * scale && y <= 88 * scale)
      ) {
        const offset = (y * width + x) * 4
        data[offset] = 82
        data[offset + 1] = 101
        data[offset + 2] = 255
      }
    }
  }

  return { data, width, height }
}

describe('browser screenshot analysis', () => {
  it('finds a subtly encoded component in an offset screenshot crop', () => {
    const capture = makeCapturedCrop()
    const results = analyzeScreenshot(
      capture.data,
      capture.width,
      capture.height,
      [DECOY, TARGET],
      {
        intensity: 0.08,
        patternSize: 64,
        scales: [1],
        step: 4,
      },
    )

    expect(results[0].component.path).toBe(TARGET.path)
    expect(results[0].component.source).toEqual(TARGET.source)
    expect(results[0].score).toBeGreaterThan(0.55)
    expect(results[0].x).toBeGreaterThanOrEqual(20)
    expect(results[0].y).toBeGreaterThanOrEqual(12)
  })

  it('returns low confidence for a flat unencoded capture', () => {
    const width = 160
    const height = 96
    const data = new Uint8ClampedArray(width * height * 4)
    data.fill(238)
    for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255

    const results = analyzeScreenshot(data, width, height, [TARGET, DECOY])

    expect(results[0].score).toBeLessThan(0.2)
  })

  it.each([1, 2])(
    'recovers the carrier beside strong borders and coloured avatars at %sx',
    (scale) => {
      const capture = makeBusyEdgeCrop(true, scale)
      const results = analyzeScreenshot(
        capture.data,
        capture.width,
        capture.height,
        [DECOY, TARGET],
        {
          intensity: 0.08,
          patternSize: 64,
          scales: [1, 2],
        },
      )

      expect(results[0].component.path).toBe(TARGET.path)
      expect(results[0].score).toBeGreaterThan(0.42)
      expect(results[0].score - results[1].score).toBeGreaterThan(0.1)
      expect(results[0].tileSize).toBe(64 * scale)
      expect(results[0].x).toBeGreaterThanOrEqual(29 * scale)
      expect(results[0].x + results[0].tileSize).toBeLessThanOrEqual(
        163 * scale,
      )
      expect(results[0].y).toBeGreaterThanOrEqual(0)
      expect(results[0].y + results[0].tileSize).toBeLessThanOrEqual(
        85 * scale,
      )
    },
  )

  it.each([1, 2])(
    'does not invent a %sx match from the same borders and avatars without a carrier',
    (scale) => {
      const capture = makeBusyEdgeCrop(false, scale)
      const results = analyzeScreenshot(
        capture.data,
        capture.width,
        capture.height,
        [DECOY, TARGET],
        {
          intensity: 0.08,
          patternSize: 64,
          scales: [1, 2],
        },
      )

      expect(results[0].score).toBeLessThan(0.42)
    },
  )

  it('returns the nested chip source when its tile dominates the crop', () => {
    const parent: ComponentDescriptor = {
      path: 'SAMPLE_APP/focus-card',
      type: 'card',
      depth: 2,
      source: {
        file: 'src/features/dashboard/FocusCard.tsx',
        line: 41,
        column: 5,
      },
    }
    const chip: ComponentDescriptor = {
      path: 'SAMPLE_APP/focus-card/pill-research',
      type: 'chip',
      depth: 3,
      patternSize: 32,
      source: {
        file: 'src/features/dashboard/FocusCard.tsx',
        line: 58,
        column: 11,
      },
    }

    // Crop is mostly the chip carrier (as when the user frames a pill).
    const width = 96
    const height = 72
    const data = new Uint8ClampedArray(width * height * 4)
    const parentTile = generatePatternRgba(createPatternPayload(parent), 64, 0.08)
    const chipTile = generatePatternRgba(createPatternPayload(chip), 32, 0.08)

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        // Thin parent rim; chip fills the interior.
        const inChip = x >= 8 && x < 88 && y >= 8 && y < 64
        const tile = inChip ? chipTile : parentTile
        const tileSize = inChip ? 32 : 64
        const tileOffset =
          ((y % tileSize) * tileSize + (x % tileSize)) * 4
        const alpha = tile[tileOffset + 3] / 255
        const background = inChip ? 230 : 220
        for (let channel = 0; channel < 3; channel += 1) {
          data[offset + channel] = Math.round(
            background * (1 - alpha) + tile[tileOffset + channel] * alpha,
          )
        }
        data[offset + 3] = 255
      }
    }

    const results = analyzeScreenshot(data, width, height, [parent, chip], {
      intensity: 0.08,
      patternSize: 64,
      scales: [1],
      step: 2,
      threshold: 0.42,
    })

    expect(results[0].component.path).toBe(chip.path)
    expect(results[0].component.source).toEqual(chip.source)
    expect(results[0].score).toBeGreaterThan(0.55)
    expect(results[0].tileSize).toBe(32)

    // Same path with a wrong source must not match the pixels (mapping is in the noise).
    const wrongSource: ComponentDescriptor = {
      ...chip,
      source: {
        file: 'src/features/dashboard/FocusCard.tsx',
        line: 999,
        column: 1,
      },
    }
    const wrong = analyzeScreenshot(data, width, height, [wrongSource], {
      intensity: 0.08,
      patternSize: 64,
      scales: [1],
      step: 2,
    })
    expect(wrong[0].score).toBeLessThan(0.42)
  })
})

describe('v2 spectral analysis', () => {
  function composite(components: Array<{ descriptor: ComponentDescriptor; x: number; y: number; w: number; h: number }>, width: number, height: number, background = 236) {
    const data = new Uint8ClampedArray(width * height * 4)
    const layer = new Float64Array(width * height * 3).fill(background)
    for (const { descriptor, x: left, y: top, w, h } of components) {
      const tile = generatePatternRgba(createPatternPayload(descriptor), 64, 0.06)
      const alpha = tile[3] / 255
      for (let y = top; y < top + h; y += 1) {
        for (let x = left; x < left + w; x += 1) {
          const source = (((y - top) % 64) * 64 + ((x - left) % 64)) * 4
          for (let channel = 0; channel < 3; channel += 1) {
            const index = (y * width + x) * 3 + channel
            layer[index] = layer[index] * (1 - alpha) + tile[source + channel] * alpha
          }
        }
      }
    }
    for (let index = 0; index < width * height; index += 1) {
      for (let channel = 0; channel < 3; channel += 1) data[index * 4 + channel] = Math.round(layer[index * 3 + channel])
      data[index * 4 + 3] = 255
    }
    return data
  }

  it('names the right tag among 60 at default browser opacity from an off-grid crop', () => {
    const registry = Array.from({ length: 60 }, (_, index) => ({
      path: `page/section-${index % 6}/item-${index}`,
      type: 'div',
      depth: 3,
    }))
    for (const target of registry.slice(0, 12)) {
      const full = composite([{ descriptor: target, x: 0, y: 0, w: 192, h: 192 }], 192, 192)
      const crop = new Uint8ClampedArray(128 * 128 * 4)
      for (let y = 0; y < 128; y += 1) {
        crop.set(full.subarray(((y + 11) * 192 + 19) * 4, ((y + 11) * 192 + 147) * 4), y * 128 * 4)
      }
      const results = analyzeScreenshot(crop, 128, 128, registry, { scales: [1], threshold: 0.5 })
      expect(results[0].component.path).toBe(target.path)
      expect(results[0].score).toBeGreaterThan(0.85)
    }
  })

  it('keeps unrelated tags below the v2 threshold', () => {
    const registry = Array.from({ length: 40 }, (_, index) => ({ path: `page/item-${index}`, type: 'div', depth: 2 }))
    const data = composite([{ descriptor: registry[0], x: 0, y: 0, w: 128, h: 128 }], 128, 128)
    const results = analyzeScreenshot(data, 128, 128, registry, { scales: [1], threshold: 0 })
    for (const result of results.slice(1)) expect(result.score).toBeLessThan(0.45)
  })
})
