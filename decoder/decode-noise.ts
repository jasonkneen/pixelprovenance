/**
 * Noise Pattern Decoder
 *
 * Extracts repeating noise patterns from screenshots and matches them
 * against a registry to identify components.
 */

import { readFileSync, existsSync } from 'fs'
import { PNG } from 'pngjs'
import { fileURLToPath } from 'url'

// Hash function (must match DevTagNoise.tsx)
function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return h >>> 0
}

// Generate expected hash for a given component data
function generatePatternHash(data: string, tileSize: number = 16): string {
  const seed = hash(data)

  const tile: number[] = []
  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const noise = ((seed * (x + 1) * (y + 1) * 9973) % 256) / 256
      const variation = Math.floor((noise - 0.5) * 2 * 0.04 * 255)
      const gray = 128 + variation
      tile.push(gray)
    }
  }

  return hash(tile.join(',')).toString(16)
}

// Extract tile hash from image region
function extractTileHash(
  data: Buffer,
  width: number,
  startX: number,
  startY: number,
  tileSize: number = 16
): string {
  const values: number[] = []

  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const px = startX + x
      const py = startY + y
      if (px < width) {
        const idx = (py * width + px) * 4
        const gray = Math.round((data[idx] + data[idx + 1] + data[idx + 2]) / 3)
        values.push(gray)
      }
    }
  }

  return hash(values.join(',')).toString(16)
}

// Build registry of all possible component paths
interface RegistryEntry {
  path: string
  type: string
  depth: number
  hash: string
}

function buildRegistry(components: Array<{ path: string; type: string; depth: number }>): RegistryEntry[] {
  const registry: RegistryEntry[] = []

  for (const comp of components) {
    const data = JSON.stringify({ p: comp.path, t: comp.type, d: comp.depth })
    const patternHash = generatePatternHash(data)

    registry.push({
      path: comp.path,
      type: comp.type,
      depth: comp.depth,
      hash: patternHash
    })
  }

  return registry
}

// Scan image and identify components
function scanImage(pngData: Buffer, registry: RegistryEntry[], tileSize: number = 16) {
  const png = PNG.sync.read(pngData)
  const { width, height, data } = png

  const found = new Map<string, { path: string; type: string; count: number }>()

  // Sample grid across the image
  const step = tileSize * 2 // Sample every 2 tiles

  for (let y = 0; y < height - tileSize; y += step) {
    for (let x = 0; x < width - tileSize; x += step) {
      const tileHash = extractTileHash(data, width, x, y, tileSize)

      // Look up in registry
      const match = registry.find(r => r.hash === tileHash)
      if (match) {
        const key = match.path
        if (found.has(key)) {
          found.get(key)!.count++
        } else {
          found.set(key, { path: match.path, type: match.type, count: 1 })
        }
      }
    }
  }

  // Sort by count (most frequent = most coverage)
  return Array.from(found.values()).sort((a, b) => b.count - a.count)
}

// CLI
const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  const args = process.argv.slice(2)
  const imagePath = args[0]

  if (!imagePath) {
    console.error('Usage: decode-noise.ts <image.png>')
    process.exit(1)
  }

  if (!existsSync(imagePath)) {
    console.error(`File not found: ${imagePath}`)
    process.exit(1)
  }

  // Define expected components (in a real app, this would come from build-time registry)
  const components = [
    { path: 'BILLING_PAGE', type: 'page', depth: 1 },
    { path: 'BILLING_PAGE/metadata-panel', type: 'panel', depth: 2 },
    { path: 'BILLING_PAGE/actions-panel', type: 'panel', depth: 2 },
    { path: 'BILLING_PAGE/actions-panel/save-btn', type: 'button', depth: 3 },
    { path: 'BILLING_PAGE/actions-panel/cancel-btn', type: 'button', depth: 3 },
    { path: 'BILLING_PAGE/actions-panel/delete-btn', type: 'button', depth: 3 },
    { path: 'BILLING_PAGE/decode-panel', type: 'panel', depth: 2 },
  ]

  console.log('Building pattern registry...')
  const registry = buildRegistry(components)

  console.log(`Registry contains ${registry.length} patterns\n`)

  console.log('Scanning image...')
  const pngData = readFileSync(imagePath)
  const results = scanImage(pngData, registry)

  if (results.length === 0) {
    console.log('\nNo components detected in screenshot')
    process.exit(1)
  }

  console.log(`\n=== Found ${results.length} components ===\n`)

  for (const result of results) {
    const coverage = result.count > 10 ? 'high' : result.count > 5 ? 'medium' : 'low'
    console.log(`✓ ${result.path.padEnd(50)} (${result.type}, coverage: ${coverage})`)
  }

  console.log('')
}

export { buildRegistry, scanImage, generatePatternHash }
export type { RegistryEntry }
