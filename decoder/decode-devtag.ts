/**
 * DevTag Decoder - Extract metadata from screenshot PNGs
 *
 * Usage:
 *   npx ts-node decode-devtag.ts screenshot.png
 *   npx ts-node decode-devtag.ts screenshot.png --registry ../registry/devtags.registry.json
 */

import { readFileSync, existsSync } from 'fs'
import { PNG } from 'pngjs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// Magic bytes to identify our strip (ASCII: "DTAG")
const MAGIC = [0x44, 0x54, 0x41, 0x47]
const STRIP_HEIGHT = 4 // 4px to survive Retina 2x scaling
const STRIP_SEARCH_ROWS = 8 // Search more rows to handle 2x scaling

interface DecodedPayload {
  version: number
  flags: number
  routeHash: number
  sha: string
  viewId: string
  timestamp: number
  checksum: number
  checksumValid: boolean
}

interface RegistryEntry {
  route: string
  entry: string
  owners?: string[]
  tests?: string[]
  storybook?: string
}

type Registry = Record<string, RegistryEntry>

/**
 * Extract bytes from pixel data
 * Each pixel stores 3 bytes (R, G, B)
 */
function extractBytesFromRow(
  data: Buffer,
  width: number,
  rowIndex: number
): number[] {
  const bytes: number[] = []
  const rowOffset = rowIndex * width * 4

  for (let x = 0; x < width; x++) {
    const idx = rowOffset + x * 4
    bytes.push(data[idx])     // R
    bytes.push(data[idx + 1]) // G
    bytes.push(data[idx + 2]) // B
  }

  return bytes
}

/**
 * Find magic bytes in the byte stream
 */
function findMagic(bytes: number[]): number {
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (
      bytes[i] === MAGIC[0] &&
      bytes[i + 1] === MAGIC[1] &&
      bytes[i + 2] === MAGIC[2] &&
      bytes[i + 3] === MAGIC[3]
    ) {
      return i
    }
  }
  return -1
}

/**
 * Decode bytes to string (UTF-8)
 */
function bytesToString(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/**
 * Parse the payload from bytes
 */
function parsePayload(bytes: number[], startIdx: number): DecodedPayload | null {
  let idx = startIdx

  // Skip magic (4 bytes)
  idx += 4

  // Version (1 byte)
  const version = bytes[idx++]

  // Flags (1 byte)
  const flags = bytes[idx++]

  // Route hash (4 bytes, big-endian)
  const routeHash =
    (bytes[idx++] << 24) |
    (bytes[idx++] << 16) |
    (bytes[idx++] << 8) |
    bytes[idx++]

  // Git SHA (7 bytes)
  const shaBytes = bytes.slice(idx, idx + 7)
  idx += 7
  const sha = bytesToString(shaBytes).replace(/0+$/, '') // Trim trailing zeros

  // ViewId length (1 byte)
  const viewIdLen = bytes[idx++]

  // ViewId (n bytes)
  const viewIdBytes = bytes.slice(idx, idx + viewIdLen)
  idx += viewIdLen
  const viewId = bytesToString(viewIdBytes)

  // Timestamp (4 bytes, big-endian)
  const timestamp =
    ((bytes[idx++] << 24) |
      (bytes[idx++] << 16) |
      (bytes[idx++] << 8) |
      bytes[idx++]) >>> 0

  // Checksum (1 byte)
  const storedChecksum = bytes[idx]

  // Verify checksum (XOR of all bytes before checksum)
  const payloadBytes = bytes.slice(startIdx, idx)
  const computedChecksum = payloadBytes.reduce((acc, b) => acc ^ b, 0)
  const checksumValid = storedChecksum === computedChecksum

  return {
    version,
    flags,
    routeHash,
    sha,
    viewId,
    timestamp,
    checksum: storedChecksum,
    checksumValid
  }
}

/**
 * Try to decode from both top and bottom of image
 * Searches more rows to handle Retina 2x scaling
 */
function decodeFromPNG(pngData: Buffer): DecodedPayload | null {
  const png = PNG.sync.read(pngData)
  const { width, height, data } = png

  // Try bottom rows first (most common position)
  // Search more rows to handle 2x Retina scaling
  for (let row = height - STRIP_SEARCH_ROWS; row < height; row++) {
    if (row < 0) continue
    const bytes = extractBytesFromRow(data, width, row)
    const magicIdx = findMagic(bytes)
    if (magicIdx !== -1) {
      const payload = parsePayload(bytes, magicIdx)
      if (payload?.checksumValid) {
        return payload
      }
    }
  }

  // Try top rows
  for (let row = 0; row < STRIP_SEARCH_ROWS; row++) {
    if (row >= height) continue
    const bytes = extractBytesFromRow(data, width, row)
    const magicIdx = findMagic(bytes)
    if (magicIdx !== -1) {
      const payload = parsePayload(bytes, magicIdx)
      if (payload?.checksumValid) {
        return payload
      }
    }
  }

  return null
}

/**
 * Load registry and lookup viewId
 */
function loadRegistry(registryPath: string): Registry | null {
  if (!existsSync(registryPath)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(registryPath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Format timestamp as ISO string
 */
function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString()
}

/**
 * Main decode function
 */
export function decodeDevTag(
  imagePath: string,
  registryPath?: string
): {
  payload: DecodedPayload | null
  registry: RegistryEntry | null
  error?: string
} {
  if (!existsSync(imagePath)) {
    return { payload: null, registry: null, error: `File not found: ${imagePath}` }
  }

  const pngData = readFileSync(imagePath)
  const payload = decodeFromPNG(pngData)

  if (!payload) {
    return { payload: null, registry: null, error: 'No DevTag found in image' }
  }

  let registry: RegistryEntry | null = null
  if (registryPath) {
    const reg = loadRegistry(registryPath)
    if (reg && payload.viewId in reg) {
      registry = reg[payload.viewId]
    }
  }

  return { payload, registry }
}

// CLI entrypoint (ESM compatible)
const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  const args = process.argv.slice(2)
  const imagePath = args[0]
  const registryIdx = args.indexOf('--registry')
  const registryPath = registryIdx !== -1 ? args[registryIdx + 1] : undefined

  if (!imagePath) {
    console.error('Usage: decode-devtag.ts <image.png> [--registry path/to/registry.json]')
    process.exit(1)
  }

  const result = decodeDevTag(imagePath, registryPath)

  if (result.error) {
    console.error(`Error: ${result.error}`)
    process.exit(1)
  }

  console.log('\n=== DevTag Decoded ===\n')
  console.log(`  View ID:     ${result.payload!.viewId}`)
  console.log(`  Git SHA:     ${result.payload!.sha || '(none)'}`)
  console.log(`  Route Hash:  0x${result.payload!.routeHash.toString(16).padStart(8, '0')}`)
  console.log(`  Timestamp:   ${formatTimestamp(result.payload!.timestamp)}`)
  console.log(`  Flags:       ${result.payload!.flags}`)
  console.log(`  Version:     ${result.payload!.version}`)
  console.log(`  Checksum:    ${result.payload!.checksumValid ? 'VALID' : 'INVALID'}`)

  if (result.registry) {
    console.log('\n=== Registry Lookup ===\n')
    console.log(`  Route:       ${result.registry.route}`)
    console.log(`  Entry:       ${result.registry.entry}`)
    if (result.registry.owners?.length) {
      console.log(`  Owners:      ${result.registry.owners.join(', ')}`)
    }
    if (result.registry.tests?.length) {
      console.log(`  Tests:       ${result.registry.tests.join(', ')}`)
    }
    if (result.registry.storybook) {
      console.log(`  Storybook:   ${result.registry.storybook}`)
    }
  }

  console.log('')
}

export type { DecodedPayload, RegistryEntry, Registry }
