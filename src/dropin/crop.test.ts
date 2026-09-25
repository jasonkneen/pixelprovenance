import { describe, expect, it } from 'vitest'

import { analyzeScreenshot } from '../demo-analysis.js'
import {
  createPatternPayload,
  generatePatternRgba,
  type ComponentDescriptor,
} from '../pattern.js'
import { finishCrop, MIN_SELECTION_PX, normalizeRect, snapRect } from './crop.js'

const CTA: ComponentDescriptor = {
  path: 'pricing/cta',
  type: 'button',
  depth: 2,
  source: { file: 'src/Pricing.tsx', line: 88, column: 9 },
}

describe('normalizeRect / snapRect', () => {
  it('orders a dragged box and snaps short drags to 32px', () => {
    expect(normalizeRect({ x: 40, y: 50 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      w: 30,
      h: 30,
    })
    expect(
      snapRect(
        { x: 10, y: 10, w: 8, h: 8 },
        { width: 400, height: 300 },
      ),
    ).toEqual({
      x: 0,
      y: 0,
      w: MIN_SELECTION_PX,
      h: MIN_SELECTION_PX,
    })
  })
})

describe('finishCrop', () => {
  it('packages the matching codebook entry from crop pixels', () => {
    const size = 64
    const tile = generatePatternRgba(createPatternPayload(CTA), size, 0.08)
    const data = new Uint8ClampedArray(size * size * 4)
    for (let i = 0; i < size * size; i += 1) {
      const o = i * 4
      for (let c = 0; c < 3; c += 1) {
        data[o + c] = Math.round(224 * (1 - 3 / 255) + tile[o + c] * 3 / 255)
      }
      data[o + 3] = 255
    }
    const matches = analyzeScreenshot(data, size, size, [CTA], {
      intensity: 0.08,
      patternSize: 64,
      scales: [1],
      threshold: 0.42,
    })
    const pkg = finishCrop({
      pageId: 'pricing',
      rect: { x: 80, y: 420, w: 64, h: 64 },
      image: 'data:image/png;base64,QQ==',
      html: '<button data-pp="cta">Start</button>',
      selector: '[data-pp="cta"]',
      matches,
      threshold: 0.42,
    })
    expect(pkg.path).toBe('pricing/cta')
    expect(pkg.source).toEqual(CTA.source)
    expect(pkg.score).toBeGreaterThan(0.7)
  })

  it('falls back to a crop region when nothing matches', () => {
    const pkg = finishCrop({
      pageId: 'pricing',
      rect: { x: 0, y: 0, w: 64, h: 64 },
      image: 'data:image/png;base64,QQ==',
      html: '',
      selector: 'body',
      matches: [],
      threshold: 0.42,
    })
    expect(pkg.path).toBe('pricing/crop')
    expect(pkg.type).toBe('crop')
    expect(pkg.score).toBeUndefined()
  })
})
