/**
 * Perceptual Noise Decoder
 *
 * Extracts patterns that survive Retina 2x scaling by using
 * perceptual features (frequency, match) instead of exact pixels.
 */

import { readFileSync, existsSync } from 'fs'
import { PNG } from 'pngjs'
import { fileURLToPath } from 'url'

// PRNG matching encoder
class SeededRandom {
  private seed: number

  constructor(seed: number) {
    this.seed = seed
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280
    return this.seed / 233280
  }
}

function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return h >>> 0
}

// Generate expected pattern (must match encoder exactly)
function generatePattern(
  data: string,
  tileSize: number = 64,
  intensity: number = 0.08
): number[][] {
  const seed = hash(data)
  const rng = new SeededRandom(seed)

  const freq1 = 2 + (seed % 5)
  const freq2 = 6 + ((seed >> 8) % 5)
  const freq3 = 12 + ((seed >> 16) % 6)

  const phase1 = rng.next() * Math.PI * 2
  const phase2 = rng.next() * Math.PI * 2
  const phase3 = rng.next() * Math.PI * 2

  const amp1 = 0.4 + rng.next() * 0.3
  const amp2 = 0.3 + rng.next() * 0.3
  const amp3 = 0.3 + rng.next() * 0.2

  const pattern: number[][] = []

  for (let y = 0; y < tileSize; y++) {
    const row: number[] = []
    for (let x = 0; x < tileSize; x++) {
      const val1 = Math.sin((x / tileSize) * freq1 * Math.PI * 2 + phase1) * amp1
      const val2 = Math.sin((y / tileSize) * freq2 * Math.PI * 2 + phase2) * amp2
      const val3 = Math.sin((x / tileSize + y / tileSize) * freq3 * Math.PI * 2 + phase3) * amp3

      const combined = (val1 + val2 + val3) / 3
      const variation = combined * intensity * 255
      const gray = 245 + variation

      row.push(gray)
    }
    pattern.push(row)
  }

  return pattern
}

// Extract grayscale tile from image
function extractTile(
  data: Buffer,
  width: number,
  startX: number,
  startY: number,
  tileSize: number
): number[][] {
  const tile: number[][] = []

  for (let y = 0; y < tileSize; y++) {
    const row: number[] = []
    for (let x = 0; x < tileSize; x++) {
      const px = startX + x
      const py = startY + y
      if (px < width && py < width) { // Assuming square-ish
        const idx = (py * width + px) * 4
        const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
        row.push(gray)
      } else {
        row.push(0)
      }
    }
    tile.push(row)
  }

  return tile
}

// Compute match between two patterns (perceptual similarity)
// Returns value between -1 and 1 (1 = perfect match)
function compare(pattern1: number[][], pattern2: number[][]): number {
  const size = Math.min(pattern1.length, pattern2.length)

  let sum1 = 0, sum2 = 0, sumSq1 = 0, sumSq2 = 0, sumProd = 0
  let count = 0

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v1 = pattern1[y]?.[x] ?? 0
      const v2 = pattern2[y]?.[x] ?? 0

      sum1 += v1
      sum2 += v2
      sumSq1 += v1 * v1
      sumSq2 += v2 * v2
      sumProd += v1 * v2
      count++
    }
  }

  const mean1 = sum1 / count
  const mean2 = sum2 / count

  const numerator = sumProd - count * mean1 * mean2
  const denom1 = Math.sqrt(sumSq1 - count * mean1 * mean1)
  const denom2 = Math.sqrt(sumSq2 - count * mean2 * mean2)

  if (denom1 === 0 || denom2 === 0) return 0

  return numerator / (denom1 * denom2)
}

// Build registry with expected patterns
interface RegistryEntry {
  path: string
  type: string
  depth: number
  pattern: number[][]
}

function build(
  components: Array<{ path: string; type: string; depth: number }>,
  tileSize: number = 64,
  intensity: number = 0.08
): RegistryEntry[] {
  return components.map(comp => {
    const data = JSON.stringify({ p: comp.path, t: comp.type, d: comp.depth })
    const pattern = generatePattern(data, tileSize, intensity)

    return {
      path: comp.path,
      type: comp.type,
      depth: comp.depth,
      pattern
    }
  })
}

// Scan image and match patterns
function scan(
  pngData: Buffer,
  registry: RegistryEntry[],
  tileSize: number = 64,
  threshold: number = 0.7 // Match threshold for match
) {
  const png = PNG.sync.read(pngData)
  const { width, height, data } = png

  const matches = new Map<string, { path: string; type: string; score: number; count: number }>()

  // Sample grid - check every 32 pixels
  const step = 32

  for (let y = 0; y < height - tileSize; y += step) {
    for (let x = 0; x < width - tileSize; x += step) {
      const tile = extractTile(data, width, x, y, tileSize)

      // Match against all registered patterns
      for (const entry of registry) {
        const score = compare(tile, entry.pattern)

        if (score > threshold) {
          const key = entry.path
          if (matches.has(key)) {
            const existing = matches.get(key)!
            existing.count++
            existing.score = Math.max(existing.score, score)
          } else {
            matches.set(key, {
              path: entry.path,
              type: entry.type,
              score: score,
              count: 1
            })
          }
        }
      }
    }
  }

  // Sort by count (coverage area) then score
  return Array.from(matches.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return b.score - a.score
  })
}

// CLI
const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  const args = process.argv.slice(2)
  const imagePath = args[0]

  if (!imagePath) {
    console.error('Usage: decode.ts <image.png>')
    process.exit(1)
  }

  if (!existsSync(imagePath)) {
    console.error(`File not found: ${imagePath}`)
    process.exit(1)
  }

  // Expected components
  const components = [
    { path: 'BILLING_PAGE', type: 'page', depth: 1 },
    { path: 'BILLING_PAGE/metadata-panel', type: 'panel', depth: 2 },
    { path: 'BILLING_PAGE/actions-panel', type: 'panel', depth: 2 },
    { path: 'BILLING_PAGE/actions-panel/save-btn', type: 'button', depth: 3 },
    { path: 'BILLING_PAGE/actions-panel/cancel-btn', type: 'button', depth: 3 },
    { path: 'BILLING_PAGE/actions-panel/delete-btn', type: 'button', depth: 3 },
    { path: 'BILLING_PAGE/decode-panel', type: 'panel', depth: 2 },
  ]

  console.log('Building perceptual pattern registry...')
  const registry = build(components, 64, 0.15) // Match component intensity
  console.log(`Registry: ${registry.length} patterns\n`)

  console.log('Scanning image...')
  const pngData = readFileSync(imagePath)
  const results = scan(pngData, registry, 64, 0.15) // Lower threshold

  if (results.length === 0) {
    console.log('\nNo components detected')
    process.exit(1)
  }

  console.log(`\n=== Found ${results.length} components ===\n`)

  for (const r of results) {
    const coverage = r.count > 20 ? 'high' : r.count > 10 ? 'medium' : 'low'
    const confidence = (r.score * 100).toFixed(1)
    console.log(`✓ ${r.path.padEnd(50)} (${r.type}, ${confidence}%, ${coverage})`)
  }

  console.log('')
}

export { build, scan, generatePattern }
