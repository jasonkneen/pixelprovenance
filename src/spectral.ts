import type { PatternMatrix } from './pattern.js'

/**
 * Shift-invariant detector for v2/v3 carriers.
 *
 * A carrier tiles with period T, so folding a region modulo T stacks every
 * repetition into one T×T cell grid and averages away 8-bit posterisation.
 * The carrier is a sum of known integer-frequency waves, so the folded
 * grid's DFT at those bins gives the correlation at every cyclic shift in
 * O(waves) per shift — no position grid to fall between, unlike a sampled
 * spatial search whose peak is only ~2px wide at these frequencies.
 *
 * v2 carriers live on the chroma axis (`R − (G+B)/2`) and decode against
 * the chroma channel. v3 carriers live on the luminance axis (`R = G = B`)
 * to survive JPEG 4:2:0 chroma subsampling, so they decode against luma.
 */

export interface Wave {
  fx: number
  fy: number
  phase: number
}

export interface SpectralEntry {
  waves: Wave[]
  /** Generated template at tile size T, used for the exact final score. */
  pattern: PatternMatrix
}

export interface SpectralMatch {
  score: number
  /** Window origin in image pixels. */
  x: number
  y: number
  /** Windows scoring at or above the threshold (sliding mode). */
  count: number
}

// Adjacent-pixel chroma limit separating content edges from the carrier.
// The smoothness test must not depend on which channel the carrier lives on:
// v2 carriers are luma-neutral so an adjacent-luma test trivially passes, but
// v3 carriers modulate luma directly (R = G = B = 128 + k) and the highest
// wave pushes adjacent luma steps past the test threshold. Chroma is content-
// sensitive (text strokes, borders, JPEG edges all show up as a chroma jump)
// and is irrelevant to either v2 or v3 as a carrier channel, so testing
// chroma separates content edges from carrier in both versions.
const MAX_CHROMA_STEP = 6
const MIN_FILLED_SHARE = 0.5
const MAX_CYCLES = 7

interface Folded {
  size: number
  values: Float64Array
  variance: number
  real: Float64Array
  imag: Float64Array
}

/**
 * Fold a window modulo `size`. Edge pixels are skipped, and each flat region
 * (connected through smooth steps) has its own mean removed first, so a card
 * beside a differently tinted margin does not imprint its outline.
 *
 * `channel` selects which per-pixel signal feeds the carrier:
 *  - 'chroma' — `R − (G+B)/2`. Used by v1/v2. Destroyed by JPEG 4:2:0.
 *  - 'luma'   — `(R+G+B)/3`. Used by v3. Survives JPEG because the Y plane
 *                of Y'CbCr is kept at full resolution under 4:2:0 subsampling.
 */
function fold(
  data: ArrayLike<number>,
  width: number,
  height: number,
  originX: number,
  originY: number,
  windowWidth: number,
  windowHeight: number,
  size: number,
  channel: 'chroma' | 'luma' = 'chroma',
): Folded | null {
  const w = Math.min(width, originX + windowWidth) - originX
  const h = Math.min(height, originY + windowHeight) - originY
  const pixels = w * h
  const chroma = new Float32Array(pixels)
  const luma = new Float32Array(pixels)
  const visible = new Uint8Array(pixels)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const offset = ((originY + y) * width + originX + x) * 4
      const index = y * w + x
      if (data[offset + 3] === 0) continue
      visible[index] = 1
      const r = data[offset]
      const g = data[offset + 1]
      const b = data[offset + 2]
      chroma[index] = r - (g + b) / 2
      luma[index] = (r + g + b) / 3
    }
  }
  const signal = channel === 'luma' ? luma : chroma
  // Smoothness test uses the *non-signal* channel. v2 carriers are
  // luminance-neutral, so adjacent luma steps are ~0 and every pixel is
  // smooth; chroma is left to carry the signal. v3 carriers make R=G=B, so
  // chroma is ~0 and luma carries the signal. Content edges (text strokes,
  // borders) produce a sharp jump on both axes, so either test catches them.
  const smoothChannel = channel === 'luma' ? chroma : luma
  const smooth = (first: number, second: number) =>
    visible[first] === 1 && visible[second] === 1 &&
    Math.abs(smoothChannel[first] - smoothChannel[second]) <= MAX_CHROMA_STEP
  // A pixel is usable when it is smooth with every in-window 4-neighbour.
  const usable = new Uint8Array(pixels)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const index = y * w + x
      if (!visible[index]) continue
      if (x + 1 < w && !smooth(index, index + 1)) continue
      if (x > 0 && !smooth(index, index - 1)) continue
      if (y + 1 < h && !smooth(index, index + w)) continue
      if (y > 0 && !smooth(index, index - w)) continue
      usable[index] = 1
    }
  }
  // Label flat regions (4-connected usable pixels) and take their means.
  const label = new Int32Array(pixels).fill(-1)
  const regionSums: number[] = []
  const regionCounts: number[] = []
  const stack: number[] = []
  for (let start = 0; start < pixels; start += 1) {
    if (!usable[start] || label[start] !== -1) continue
    const region = regionSums.length
    let sum = 0
    let count = 0
    label[start] = region
    stack.push(start)
    while (stack.length) {
      const index = stack.pop()!
      sum += signal[index]
      count += 1
      const x = index % w
      const neighbours = [
        x + 1 < w ? index + 1 : -1,
        x > 0 ? index - 1 : -1,
        index + w < pixels ? index + w : -1,
        index - w >= 0 ? index - w : -1,
      ]
      for (const next of neighbours) {
        if (next < 0 || !usable[next] || label[next] !== -1) continue
        label[next] = region
        stack.push(next)
      }
    }
    regionSums.push(sum)
    regionCounts.push(count)
  }
  // Regions smaller than a quarter tile cannot carry a zero-mean carrier.
  const minRegion = (size * size) / 4
  const sums = new Float64Array(size * size)
  const counts = new Uint32Array(size * size)
  for (let y = 0; y < h; y += 1) {
    const cellRow = (y % size) * size
    for (let x = 0; x < w; x += 1) {
      const index = y * w + x
      const region = label[index]
      if (region < 0 || regionCounts[region] < minRegion) continue
      const cell = cellRow + (x % size)
      sums[cell] += signal[index] - regionSums[region] / regionCounts[region]
      counts[cell] += 1
    }
  }
  let filled = 0
  let total = 0
  for (let cell = 0; cell < sums.length; cell += 1) {
    if (counts[cell] === 0) continue
    filled += 1
    total += sums[cell] / counts[cell]
  }
  if (filled < sums.length * MIN_FILLED_SHARE) return null
  const mean = total / filled
  const values = new Float64Array(size * size)
  let variance = 0
  for (let cell = 0; cell < sums.length; cell += 1) {
    // Empty cells sit at the mean so they contribute nothing.
    const value = counts[cell] === 0 ? 0 : sums[cell] / counts[cell] - mean
    values[cell] = value
    variance += value * value
  }
  if (variance === 0) return null

  // DFT at fx ∈ [0, 7], fy ∈ [-7, 7]: rows first, then columns.
  const rowReal = new Float64Array(size * (MAX_CYCLES + 1))
  const rowImag = new Float64Array(size * (MAX_CYCLES + 1))
  for (let y = 0; y < size; y += 1) {
    for (let fx = 0; fx <= MAX_CYCLES; fx += 1) {
      let re = 0
      let im = 0
      for (let x = 0; x < size; x += 1) {
        const angle = (-2 * Math.PI * fx * x) / size
        const value = values[y * size + x]
        re += value * Math.cos(angle)
        im += value * Math.sin(angle)
      }
      rowReal[y * (MAX_CYCLES + 1) + fx] = re
      rowImag[y * (MAX_CYCLES + 1) + fx] = im
    }
  }
  const span = 2 * MAX_CYCLES + 1
  const real = new Float64Array((MAX_CYCLES + 1) * span)
  const imag = new Float64Array((MAX_CYCLES + 1) * span)
  for (let fx = 0; fx <= MAX_CYCLES; fx += 1) {
    for (let fy = -MAX_CYCLES; fy <= MAX_CYCLES; fy += 1) {
      let re = 0
      let im = 0
      for (let y = 0; y < size; y += 1) {
        const angle = (-2 * Math.PI * fy * y) / size
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const a = rowReal[y * (MAX_CYCLES + 1) + fx]
        const b = rowImag[y * (MAX_CYCLES + 1) + fx]
        re += a * cos - b * sin
        im += a * sin + b * cos
      }
      real[fx * span + fy + MAX_CYCLES] = re
      imag[fx * span + fy + MAX_CYCLES] = im
    }
  }
  return { size, values, variance, real, imag }
}

/** Matched-filter response Σ F·template(shifted) from the DFT bins. */
function response(folded: Folded, waves: Wave[], dx: number, dy: number): number {
  const span = 2 * MAX_CYCLES + 1
  let total = 0
  for (const wave of waves) {
    const bin = wave.fx * span + wave.fy + MAX_CYCLES
    // Σ F sin(θ + α) = Im(e^{iα} · conj(X)), α = φ − 2π(fx·dx + fy·dy)/T.
    const alpha = wave.phase - (2 * Math.PI * (wave.fx * dx + wave.fy * dy)) / folded.size
    const re = folded.real[bin]
    const im = -folded.imag[bin]
    total += Math.sin(alpha) * re + Math.cos(alpha) * im
  }
  return total
}

function exactScore(folded: Folded, pattern: PatternMatrix, dx: number, dy: number): number {
  const size = folded.size
  let templateSum = 0
  let templateSquareSum = 0
  let productSum = 0
  const count = size * size
  for (let y = 0; y < size; y += 1) {
    const row = pattern[(y - dy + size) % size]
    for (let x = 0; x < size; x += 1) {
      const expected = row[(x - dx + size) % size]
      templateSum += expected
      templateSquareSum += expected * expected
      productSum += folded.values[y * size + x] * expected
    }
  }
  // Folded values are already mean-centred, so Σ F = 0.
  const templateVariance = templateSquareSum - (templateSum * templateSum) / count
  const denominator = Math.sqrt(folded.variance * Math.max(0, templateVariance))
  return denominator === 0 ? 0 : productSum / denominator
}

function matchFolded(folded: Folded, entry: SpectralEntry, floor: number): { score: number; dx: number; dy: number } {
  const size = folded.size
  const norm = Math.sqrt(folded.variance * (entry.waves.length * size * size) / 2)
  // Upper bound with every phase free; unrelated carriers stop here.
  const span = 2 * MAX_CYCLES + 1
  let bound = 0
  for (const wave of entry.waves) {
    const bin = wave.fx * span + wave.fy + MAX_CYCLES
    bound += Math.hypot(folded.real[bin], folded.imag[bin])
  }
  if (bound / norm < floor) return { score: bound / norm, dx: 0, dy: 0 }

  const coarse = Math.max(1, Math.floor(size / 64))
  let best = { value: Number.NEGATIVE_INFINITY, dx: 0, dy: 0 }
  for (let dy = 0; dy < size; dy += coarse) {
    for (let dx = 0; dx < size; dx += coarse) {
      const value = response(folded, entry.waves, dx, dy)
      if (value > best.value) best = { value, dx, dy }
    }
  }
  if (coarse > 1) {
    const centre = best
    for (let dy = centre.dy - coarse; dy <= centre.dy + coarse; dy += 1) {
      for (let dx = centre.dx - coarse; dx <= centre.dx + coarse; dx += 1) {
        const wrappedX = (dx + size) % size
        const wrappedY = (dy + size) % size
        const value = response(folded, entry.waves, wrappedX, wrappedY)
        if (value > best.value) best = { value, dx: wrappedX, dy: wrappedY }
      }
    }
  }
  return { score: exactScore(folded, entry.pattern, best.dx, best.dy), dx: best.dx, dy: best.dy }
}

/**
 * Where the carrier sits: the T×T window (on a T/4 grid) whose raw chroma best
 * correlates with the template at the detected phase.
 */
function localize(
  data: ArrayLike<number>,
  width: number,
  height: number,
  pattern: PatternMatrix,
  phaseX: number,
  phaseY: number,
): { x: number; y: number } {
  const size = pattern.length
  const stride = Math.max(1, Math.floor(size / 4))
  const sample = Math.max(1, Math.floor(size / 32))
  let best = { score: Number.NEGATIVE_INFINITY, x: 0, y: 0 }
  for (let top = 0; top + size <= height; top += stride) {
    for (let left = 0; left + size <= width; left += stride) {
      let observedSum = 0
      let expectedSum = 0
      let observedSquareSum = 0
      let expectedSquareSum = 0
      let productSum = 0
      let count = 0
      for (let y = top; y < top + size; y += sample) {
        const row = pattern[(((y - phaseY) % size) + size) % size]
        for (let x = left; x < left + size; x += sample) {
          const offset = (y * width + x) * 4
          if (data[offset + 3] === 0) continue
          const observed = data[offset] - (data[offset + 1] + data[offset + 2]) / 2
          const expected = row[(((x - phaseX) % size) + size) % size]
          observedSum += observed
          expectedSum += expected
          observedSquareSum += observed * observed
          expectedSquareSum += expected * expected
          productSum += observed * expected
          count += 1
        }
      }
      if (count === 0) continue
      const numerator = productSum - (observedSum * expectedSum) / count
      const denominator = Math.sqrt(
        Math.max(0, observedSquareSum - (observedSum * observedSum) / count) *
        Math.max(0, expectedSquareSum - (expectedSum * expectedSum) / count),
      )
      const score = denominator === 0 ? 0 : numerator / denominator
      if (score > best.score) best = { score, x: left, y: top }
    }
  }
  return { x: best.x, y: best.y }
}

/**
 * Score entries (all sharing tile size T) against an RGBA image.
 * `whole` folds the entire image as one region (a user crop); `sliding` folds
 * 2T windows at stride T so separate elements in a full screenshot stay apart.
 */
export function detectSpectral(
  data: ArrayLike<number>,
  width: number,
  height: number,
  size: number,
  entries: SpectralEntry[],
  options: { mode: 'whole' | 'sliding'; threshold: number; channel?: 'chroma' | 'luma' },
): SpectralMatch[] {
  const results: SpectralMatch[] = entries.map(() => ({ score: 0, x: 0, y: 0, count: 0 }))
  if (size > width || size > height || entries.length === 0) return results
  const channel = options.channel ?? 'chroma'
  const windows: Array<{ x: number; y: number; w: number; h: number }> = []
  if (options.mode === 'whole') {
    windows.push({ x: 0, y: 0, w: width, h: height })
  } else {
    const span = Math.min(2 * size, width, height)
    for (let y = 0; y + span <= height; y += size) {
      for (let x = 0; x + span <= width; x += size) {
        windows.push({ x, y, w: Math.min(2 * size, width - x), h: Math.min(2 * size, height - y) })
      }
    }
  }
  const phases: Array<{ x: number; y: number; window: { x: number; y: number; w: number; h: number } } | null> =
    entries.map(() => null)
  // Bound-pruned search below this fraction of the threshold.
  const floor = options.threshold * 0.8
  for (const window of windows) {
    const folded = fold(data, width, height, window.x, window.y, window.w, window.h, size, channel)
    if (!folded) continue
    entries.forEach((entry, index) => {
      const match = matchFolded(folded, entry, floor)
      const result = results[index]
      if (match.score >= options.threshold) result.count += 1
      if (match.score > result.score) {
        result.score = match.score
        result.x = window.x + match.dx
        result.y = window.y + match.dy
        phases[index] = { x: window.x + match.dx, y: window.y + match.dy, window }
      }
    })
  }
  // Report a real T×T box (the demo draws it) inside the winning window.
  entries.forEach((entry, index) => {
    const phase = phases[index]
    if (!phase || results[index].score < options.threshold * 0.8) return
    const window = phase.window
    const cropped = window.w === width && window.h === height
    if (!cropped) {
      results[index].x = window.x
      results[index].y = window.y
      return
    }
    const place = localize(data, width, height, entry.pattern, phase.x, phase.y)
    results[index].x = place.x
    results[index].y = place.y
  })
  return results
}

/** Spectral work estimate for budget preflight. */
export function spectralCost(width: number, height: number, size: number, entries: number, mode: 'whole' | 'sliding'): number {
  const windows = mode === 'whole' ? 1 : Math.max(1, Math.floor(width / size)) * Math.max(1, Math.floor(height / size))
  const foldCost = mode === 'whole' ? width * height : windows * 4 * size * size
  const dftCost = windows * (MAX_CYCLES + 1) * size * size
  const coarse = Math.max(1, Math.floor(size / 64))
  const searchCost = windows * entries * ((size / coarse) ** 2 * 12 + size * size)
  return foldCost + dftCost + searchCost
}
