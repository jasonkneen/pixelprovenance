/**
 * DevTagStrip - Invisible 2px strip that encodes dev metadata into screenshots
 *
 * Encodes: viewId, route hash, git SHA, flags
 * Only renders in development mode
 */

import { useEffect, useRef } from 'react'

interface DevTagPayload {
  viewId: string      // e.g., "BILLING_02"
  route: string       // e.g., "/settings/billing"
  sha?: string        // git commit SHA (first 7 chars)
  flags?: number      // bitfield for custom flags
  timestamp?: number  // optional: when rendered
}

interface DevTagStripProps {
  viewId: string
  route: string
  sha?: string
  flags?: number
  position?: 'top' | 'bottom'
}

// Magic bytes to identify our strip (ASCII: "DTAG")
const MAGIC = [0x44, 0x54, 0x41, 0x47]
const VERSION = 1
const STRIP_HEIGHT = 4 // 4px to survive Retina 2x scaling

/**
 * Encode a string to bytes (UTF-8)
 */
function stringToBytes(str: string): number[] {
  return Array.from(new TextEncoder().encode(str))
}

/**
 * Create a simple hash of a string (for route hashing)
 */
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash >>> 0 // Convert to unsigned
}

/**
 * Build the payload bytes
 * Format: [MAGIC(4)] [VERSION(1)] [FLAGS(1)] [ROUTE_HASH(4)] [SHA(7)] [VIEWID_LEN(1)] [VIEWID(n)] [CHECKSUM(1)]
 */
function buildPayload(props: DevTagPayload): number[] {
  const bytes: number[] = []

  // Magic bytes
  bytes.push(...MAGIC)

  // Version
  bytes.push(VERSION)

  // Flags (1 byte)
  bytes.push(props.flags ?? 0)

  // Route hash (4 bytes, big-endian)
  const routeHash = simpleHash(props.route)
  bytes.push((routeHash >> 24) & 0xff)
  bytes.push((routeHash >> 16) & 0xff)
  bytes.push((routeHash >> 8) & 0xff)
  bytes.push(routeHash & 0xff)

  // Git SHA (7 bytes, padded with zeros if missing)
  const sha = (props.sha ?? '').slice(0, 7).padEnd(7, '0')
  bytes.push(...stringToBytes(sha))

  // ViewId length + ViewId
  const viewIdBytes = stringToBytes(props.viewId)
  bytes.push(viewIdBytes.length)
  bytes.push(...viewIdBytes)

  // Timestamp (4 bytes, seconds since epoch, optional)
  const ts = props.timestamp ?? Math.floor(Date.now() / 1000)
  bytes.push((ts >> 24) & 0xff)
  bytes.push((ts >> 16) & 0xff)
  bytes.push((ts >> 8) & 0xff)
  bytes.push(ts & 0xff)

  // Checksum (simple XOR of all bytes)
  const checksum = bytes.reduce((acc, b) => acc ^ b, 0)
  bytes.push(checksum)

  return bytes
}

/**
 * Render payload bytes to canvas as pixel RGB values
 * Each pixel stores 3 bytes (R, G, B)
 */
function renderToCanvas(
  canvas: HTMLCanvasElement,
  payload: number[],
  width: number
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  canvas.width = width
  canvas.height = STRIP_HEIGHT

  // Calculate pixels needed (3 bytes per pixel)
  const pixelsNeeded = Math.ceil(payload.length / 3)

  // Pad payload to fill complete pixels
  const paddedPayload = [...payload]
  while (paddedPayload.length % 3 !== 0) {
    paddedPayload.push(0)
  }

  const imageData = ctx.createImageData(width, STRIP_HEIGHT)

  // Fill with encoded data (repeated across width for redundancy)
  for (let row = 0; row < STRIP_HEIGHT; row++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = x % pixelsNeeded
      const byteOffset = pixelIdx * 3

      const idx = (row * width + x) * 4
      imageData.data[idx] = paddedPayload[byteOffset] ?? 0     // R
      imageData.data[idx + 1] = paddedPayload[byteOffset + 1] ?? 0 // G
      imageData.data[idx + 2] = paddedPayload[byteOffset + 2] ?? 0 // B
      imageData.data[idx + 3] = 255 // Alpha (fully opaque)
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

/**
 * DevTagStrip Component
 * Renders an invisible 2px strip encoding dev metadata
 */
export function DevTagStrip({
  viewId,
  route,
  sha,
  flags = 0,
  position = 'bottom'
}: DevTagStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Only render in development
  if (process.env.NODE_ENV !== 'development') {
    return null
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Get parent width or use viewport width
    const width = canvas.parentElement?.clientWidth ?? window.innerWidth

    const payload = buildPayload({
      viewId,
      route,
      sha,
      flags,
      timestamp: Math.floor(Date.now() / 1000)
    })

    renderToCanvas(canvas, payload, width)
  }, [viewId, route, sha, flags])

  const style: React.CSSProperties = {
    position: 'fixed',
    left: 0,
    right: 0,
    height: `${STRIP_HEIGHT}px`,
    zIndex: 99999,
    pointerEvents: 'none',
    [position]: 0,
  }

  return (
    <canvas
      ref={canvasRef}
      style={style}
      data-devtag={viewId}
      aria-hidden="true"
    />
  )
}

/**
 * Hook to get current git SHA (for build-time injection)
 */
export function useGitSha(): string | undefined {
  // This would be replaced at build time via DefinePlugin or similar
  return typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : undefined
}

// Type declaration for build-time constant
declare const __GIT_SHA__: string | undefined

export type { DevTagPayload, DevTagStripProps }
