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
