import { describe, expect, it } from 'vitest'

import {
  clampIntensity,
  clampPatternSize,
  comparePatterns,
  createPatternPayload,
  generatePattern,
  generatePatternRgba,
  intensityToAlpha,
  isPathAncestor,
  pathDepth,
  rankByHierarchy,
  resolvePatternSize,
} from './pattern.js'

describe('frequency pattern engine', () => {
  const component = {
    path: 'LAB_DASHBOARD/inspection-panel',
    type: 'panel',
    depth: 2,
  }

  it('generates deterministic component patterns', () => {
    const payload = createPatternPayload(component)
    expect(generatePattern(payload, 32, 0.12)).toEqual(
      generatePattern(payload, 32, 0.12),
    )
  })

  it('preserves the original signed-shift signal for existing screenshots', () => {
    const payload = createPatternPayload({
      path: 'legacy-0',
      type: 'component',
      depth: 1,
    })

    expect(generatePattern(payload, 16, 0.12, 1)[0]).toEqual([
      236, 242, 240, 235, 247, 232, 243, 242,
      233, 248, 233, 241, 242, 236, 242, 240,
    ])
  })

  it('keeps the v2 chroma signal luminance-neutral at one percent per pixel', () => {
    const rgba = generatePatternRgba(
      createPatternPayload(component),
      16,
      0.06,
      2,
    )

    expect(rgba[3]).toBe(3)
    expect(rgba.every((value, index) => index % 4 !== 3 || value === 3)).toBe(true)
    for (let offset = 0; offset < rgba.length; offset += 4) {
      const luma = (rgba[offset] + rgba[offset + 1] + rgba[offset + 2]) / 3
      expect(luma).toBeGreaterThanOrEqual(127.5)
      expect(luma).toBeLessThanOrEqual(128.5)
    }
  })

  it('puts the v3 luma signal on every channel and leaves chroma at 128', () => {
    // v3 modulates R = G = B together so the carrier survives JPEG 4:2:0
    // chroma subsampling. Chroma is constant at 128; luma carries the wave.
    const rgba = generatePatternRgba(
      createPatternPayload(component),
      16,
      0.06,
      3,
    )
    expect(rgba.every((value, index) => index % 4 !== 3 || value === 3)).toBe(true)
    for (let offset = 0; offset < rgba.length; offset += 4) {
      const r = rgba[offset]
      const g = rgba[offset + 1]
      const b = rgba[offset + 2]
      expect(r).toBe(g)
      expect(g).toBe(b)
      const chroma = r - (g + b) / 2
      expect(Math.abs(chroma)).toBeLessThan(0.5)
    }
  })

  it('uses intensity as the on-screen alpha control', () => {
    const payload = createPatternPayload(component)
    expect(intensityToAlpha(0.06)).toBe(3)
    expect(generatePatternRgba(payload, 16, 0.1)[3]).toBe(5)
    expect(generatePatternRgba(payload, 16, 0.2)[3]).toBe(10)
    // Chroma shape does not depend on intensity; only opacity does.
    const low = generatePatternRgba(payload, 16, 0.06)
    const high = generatePatternRgba(payload, 16, 0.2)
    expect(low.filter((_, index) => index % 4 === 0)).toEqual(
      high.filter((_, index) => index % 4 === 0),
    )
  })

  it('keeps v2 carriers for different paths near-orthogonal at every cyclic shift', () => {
    const size = 64
    const patterns = Array.from({ length: 40 }, (_, index) =>
      generatePattern(createPatternPayload({ path: `page/list/item-${index}`, type: 'div', depth: 3 }), size),
    )
    const shifted = (matrix: number[][], dx: number, dy: number) =>
      matrix.map((_, y) => matrix[0].map((__, x) => matrix[(y + dy) % size][(x + dx) % size]))
    let worst = 0
    for (let first = 0; first < 12; first += 1) {
      for (let second = first + 1; second < patterns.length; second += 1) {
        for (const [dx, dy] of [[0, 0], [7, 3], [19, 11], [32, 32], [50, 5]]) {
          worst = Math.max(worst, comparePatterns(patterns[first], shifted(patterns[second], dx, dy)))
        }
      }
    }
    expect(worst).toBeLessThan(0.42)
  })

  it('renders no browser carrier at zero intensity', () => {
    const rgba = generatePatternRgba(createPatternPayload(component), 16, 0)

    expect(rgba.every((value, index) => index % 4 !== 3 || value === 0)).toBe(true)
  })

  it('embeds source location into the pattern seed', () => {
    const withoutSource = createPatternPayload(component)
    const withSource = createPatternPayload({
      ...component,
      source: { file: 'src/Panel.tsx', line: 12, column: 3 },
    })
    const movedSource = createPatternPayload({
      ...component,
      source: { file: 'src/Panel.tsx', line: 40, column: 3 },
    })

    expect(withoutSource).toBe('{"p":"LAB_DASHBOARD/inspection-panel","t":"panel","d":2}')
    expect(withSource).toContain('"s":{"f":"src/Panel.tsx","l":12,"c":3}')
    expect(withSource).not.toBe(withoutSource)
    expect(generatePattern(withSource, 32, 0.12)).not.toEqual(
      generatePattern(movedSource, 32, 0.12),
    )
  })

  it('resolves per-region pattern sizes for hierarchical leaves', () => {
    expect(resolvePatternSize({}, 64)).toBe(64)
    expect(resolvePatternSize({ patternSize: 32 }, 64)).toBe(32)
    expect(pathDepth('MORROW/card/chip')).toBe(3)
    expect(isPathAncestor('MORROW/card', 'MORROW/card/chip')).toBe(true)
    expect(isPathAncestor('MORROW/card', 'MORROW/other')).toBe(false)
  })

  it('prefers the deepest path when scores are close', () => {
    const ranked = rankByHierarchy(
      [
        { path: 'APP/card', depth: 2, score: 0.9 },
        { path: 'APP/card/chip', depth: 3, score: 0.86 },
        { path: 'APP/sidebar', depth: 2, score: 0.5 },
      ],
      { threshold: 0.42, margin: 0.08 },
    )

    expect(ranked.map((match) => match.path)).toEqual([
      'APP/card/chip',
      'APP/card',
      'APP/sidebar',
    ])
  })

  it('keeps a clearly stronger parent over a weaker nested signal', () => {
    const ranked = rankByHierarchy(
      [
        { path: 'APP/card', depth: 2, score: 0.92 },
        { path: 'APP/card/chip', depth: 3, score: 0.7 },
      ],
      { threshold: 0.42, margin: 0.08 },
    )

    expect(ranked[0].path).toBe('APP/card')
  })

  it('ranks score chains consistently regardless of registry order', () => {
    const parent = { path: 'APP', depth: 1, score: 0.95 }
    const child = { path: 'APP/card', depth: 2, score: 0.89 }
    const leaf = { path: 'APP/card/chip', depth: 3, score: 0.83 }
    for (const matches of [
      [parent, child, leaf], [parent, leaf, child],
      [child, parent, leaf], [child, leaf, parent],
      [leaf, parent, child], [leaf, child, parent],
    ]) {
      expect(rankByHierarchy(matches).map((match) => match.path)).toEqual([
        child.path, parent.path, leaf.path,
      ])
    }
  })

  it('keeps different component paths distinguishable', () => {
    const first = generatePattern(createPatternPayload(component), 64, 0.12)
    const second = generatePattern(
      createPatternPayload({ ...component, path: 'LAB_DASHBOARD/evidence-feed' }),
      64,
      0.12,
    )

    expect(comparePatterns(first, first)).toBeCloseTo(1, 8)
    expect(comparePatterns(first, second)).toBeLessThan(0.7)
  })

  it('clamps unsafe rendering inputs', () => {
    expect(clampPatternSize(2)).toBe(16)
    expect(clampPatternSize(500)).toBe(256)
    expect(clampIntensity(-1)).toBe(0)
    expect(clampIntensity(4)).toBe(1)
  })

  it('can generate a 2x decoder pattern for the largest CSS tile', () => {
    const pattern = generatePattern(createPatternPayload(component), 512, 0.12)
    expect(pattern).toHaveLength(512)
    expect(pattern[0]).toHaveLength(512)
  })
})
