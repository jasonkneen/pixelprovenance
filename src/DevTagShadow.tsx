/**
 * DevTagShadow - Hide metadata in a natural-looking drop shadow
 *
 * Instead of a visible colored strip, this encodes data as subtle
 * variations in shadow pixel values that look completely normal.
 */

import { useEffect, useRef } from 'react'

interface DevTagPayload {
  viewId: string
  route: string
  sha?: string
  flags?: number
}

interface DevTagShadowProps {
  viewId: string
  route: string
  sha?: string
  flags?: number
  width?: number
  height?: number
}

// Magic bytes "DTAG"
const MAGIC = [0x44, 0x54, 0x41, 0x47]
const VERSION = 1

function stringToBytes(str: string): number[] {
  return Array.from(new TextEncoder().encode(str))
}

function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash >>> 0
}

function buildPayload(props: DevTagPayload): number[] {
  const bytes: number[] = []

  bytes.push(...MAGIC)
  bytes.push(VERSION)
  bytes.push(props.flags ?? 0)

  const routeHash = simpleHash(props.route)
  bytes.push((routeHash >> 24) & 0xff)
  bytes.push((routeHash >> 16) & 0xff)
  bytes.push((routeHash >> 8) & 0xff)
  bytes.push(routeHash & 0xff)

  const sha = (props.sha ?? '').slice(0, 7).padEnd(7, '0')
  bytes.push(...stringToBytes(sha))

  const viewIdBytes = stringToBytes(props.viewId)
  bytes.push(viewIdBytes.length)
  bytes.push(...viewIdBytes)

  const ts = Math.floor(Date.now() / 1000)
  bytes.push((ts >> 24) & 0xff)
  bytes.push((ts >> 16) & 0xff)
  bytes.push((ts >> 8) & 0xff)
  bytes.push(ts & 0xff)

  const checksum = bytes.reduce((acc, b) => acc ^ b, 0)
  bytes.push(checksum)

  return bytes
}

/**
 * Encode payload into shadow pixels using LSB steganography
 *
 * We draw a natural gradient shadow, then encode bits into the
 * least significant bits of pixel values. The changes are
 * imperceptible to the human eye.
 */
function renderShadowWithData(
  canvas: HTMLCanvasElement,
  payload: number[],
  width: number,
  height: number
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  canvas.width = width
  canvas.height = height

  // Draw a natural-looking shadow gradient (dark at top, fading down)
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.15)')
  gradient.addColorStop(0.3, 'rgba(0, 0, 0, 0.08)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  // Get the image data to encode our payload
  const imageData = ctx.getImageData(0, 0, width, height)
  const pixels = imageData.data

  // Convert payload to bits
  const bits: number[] = []
  for (const byte of payload) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1)
    }
  }

  // Encode bits into the LSB of the alpha channel
  // We use the top row of pixels for encoding
  let bitIndex = 0
  for (let x = 0; x < width && bitIndex < bits.length; x++) {
    const idx = x * 4 + 3 // Alpha channel of pixel x in row 0

    // Clear LSB and set our bit
    pixels[idx] = (pixels[idx] & 0xFE) | bits[bitIndex]
    bitIndex++
  }

  // Add redundancy: repeat encoding in row 2 and 4
  for (const row of [2, 4]) {
    bitIndex = 0
    for (let x = 0; x < width && bitIndex < bits.length; x++) {
      const idx = (row * width + x) * 4 + 3
      if (idx < pixels.length) {
        pixels[idx] = (pixels[idx] & 0xFE) | bits[bitIndex]
        bitIndex++
      }
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

export function DevTagShadow({
  viewId,
  route,
  sha,
  flags = 0,
  width = 800,
  height = 12
}: DevTagShadowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Only render in development
  if (process.env.NODE_ENV !== 'development') {
    return null
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const actualWidth = canvas.parentElement?.clientWidth ?? width

    const payload = buildPayload({ viewId, route, sha, flags })
    renderShadowWithData(canvas, payload, actualWidth, height)
  }, [viewId, route, sha, flags, width, height])

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width: '100%',
        height: `${height}px`,
        pointerEvents: 'none',
      }}
      data-devtag-shadow={viewId}
      aria-hidden="true"
    />
  )
}

export type { DevTagPayload, DevTagShadowProps }
