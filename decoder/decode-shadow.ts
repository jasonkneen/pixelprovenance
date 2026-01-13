/**
 * DevTag Shadow Decoder - Extract metadata from shadow steganography
 *
 * Reads LSB-encoded data from shadow pixels
 */

import { readFileSync, existsSync } from 'fs'
import { PNG } from 'pngjs'
import { fileURLToPath } from 'url'

const MAGIC = [0x44, 0x54, 0x41, 0x47]

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

function bytesToString(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/**
 * Extract bits from LSB of alpha channel in a row
 */
function extractBitsFromRow(
  data: Buffer,
  width: number,
  row: number,
  numBits: number
): number[] {
  const bits: number[] = []
  for (let x = 0; x < width && bits.length < numBits; x++) {
    const idx = (row * width + x) * 4 + 3 // Alpha channel
    bits.push(data[idx] & 1)
  }
  return bits
}

/**
 * Convert bits array to bytes
 */
function bitsToBytes(bits: number[]): number[] {
  const bytes: number[] = []
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i + j]
    }
    bytes.push(byte)
  }
  return bytes
}

/**
 * Check if bytes start with magic
 */
function hasMagic(bytes: number[]): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === MAGIC[0] &&
    bytes[1] === MAGIC[1] &&
    bytes[2] === MAGIC[2] &&
    bytes[3] === MAGIC[3]
  )
}

/**
 * Parse payload from bytes
 */
function parsePayload(bytes: number[]): DecodedPayload | null {
  if (!hasMagic(bytes)) return null

  let idx = 4 // Skip magic

  const version = bytes[idx++]
  const flags = bytes[idx++]

  const routeHash =
    (bytes[idx++] << 24) |
    (bytes[idx++] << 16) |
    (bytes[idx++] << 8) |
    bytes[idx++]

  const shaBytes = bytes.slice(idx, idx + 7)
  idx += 7
  const sha = bytesToString(shaBytes).replace(/0+$/, '')

  const viewIdLen = bytes[idx++]
  const viewIdBytes = bytes.slice(idx, idx + viewIdLen)
  idx += viewIdLen
  const viewId = bytesToString(viewIdBytes)

  const timestamp =
    ((bytes[idx++] << 24) |
      (bytes[idx++] << 16) |
      (bytes[idx++] << 8) |
      bytes[idx++]) >>> 0

  const storedChecksum = bytes[idx]

  // Verify checksum
  const payloadBytes = bytes.slice(0, idx)
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
 * Try to decode from shadow regions (look for gradient areas)
 */
function decodeFromPNG(pngData: Buffer): DecodedPayload | null {
  const png = PNG.sync.read(pngData)
  const { width, height, data } = png

  // We need enough bits for a reasonable payload (~40 bytes = 320 bits)
  const maxPayloadBits = 512

  // Scan rows looking for LSB-encoded data
  // Check rows that might contain shadow (typically near cards/elements)
  for (let row = 0; row < height; row++) {
    const bits = extractBitsFromRow(data, width, row, maxPayloadBits)
    const bytes = bitsToBytes(bits)

    if (hasMagic(bytes)) {
      const payload = parsePayload(bytes)
      if (payload?.checksumValid) {
        return payload
      }
    }
  }

  return null
}

function loadRegistry(registryPath: string): Registry | null {
  if (!existsSync(registryPath)) return null
  try {
    return JSON.parse(readFileSync(registryPath, 'utf-8'))
  } catch {
    return null
  }
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString()
}

export function decodeShadow(
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
    return { payload: null, registry: null, error: 'No DevTag shadow found in image' }
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

// CLI
const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  const args = process.argv.slice(2)
  const imagePath = args[0]
  const registryIdx = args.indexOf('--registry')
  const registryPath = registryIdx !== -1 ? args[registryIdx + 1] : undefined

  if (!imagePath) {
    console.error('Usage: decode-shadow.ts <image.png> [--registry path/to/registry.json]')
    process.exit(1)
  }

  const result = decodeShadow(imagePath, registryPath)

  if (result.error) {
    console.error(`Error: ${result.error}`)
    process.exit(1)
  }

  console.log('\n=== DevTag Shadow Decoded ===\n')
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

export type { DecodedPayload, RegistryEntry }
