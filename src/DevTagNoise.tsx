/**
 * DevTagNoise - Encode data as a subtle repeating noise pattern
 *
 * Instead of a visible QR code, this creates a subtle texture/grain
 * pattern that looks like intentional design but encodes component data.
 * The pattern repeats across the element for redundancy.
 */

import { useEffect, useRef, createContext, useContext, type ReactNode } from 'react'

// Context for hierarchical paths
interface NoiseContext {
  path: string[]
  depth: number
}

const NoiseCtx = createContext<NoiseContext>({ path: [], depth: 0 })

// Simple hash function
function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return h >>> 0
}

// Generate a deterministic noise pattern from a string
// Each "tile" is small (e.g., 8x8) and tiles repeat across the element
function generateNoisePattern(
  data: string,
  tileSize: number = 8,
  intensity: number = 0.03 // Very subtle
): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = tileSize
  canvas.height = tileSize
  const ctx = canvas.getContext('2d')!

  const imageData = ctx.createImageData(tileSize, tileSize)
  const pixels = imageData.data

  // Convert data to a seed
  const seed = hash(data)

  // Generate pseudo-random noise based on seed + position
  // The pattern encodes the hash - each position's noise value is deterministic
  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      const idx = (y * tileSize + x) * 4

      // Deterministic "random" based on seed, x, y
      const noise = ((seed * (x + 1) * (y + 1) * 9973) % 256) / 256

      // Apply as subtle variation from gray
      // 128 = middle gray, vary by ±intensity*128
      const variation = Math.floor((noise - 0.5) * 2 * intensity * 255)
      const gray = 128 + variation

      pixels[idx] = gray     // R
      pixels[idx + 1] = gray // G
      pixels[idx + 2] = gray // B
      pixels[idx + 3] = 25   // Very low alpha for subtlety
    }
  }

  return imageData
}

// Create a data URL from the pattern
function patternToDataURL(data: string, tileSize: number, intensity: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = tileSize
  canvas.height = tileSize
  const ctx = canvas.getContext('2d')!

  const imageData = generateNoisePattern(data, tileSize, intensity)
  ctx.putImageData(imageData, 0, 0)

  return canvas.toDataURL('image/png')
}

interface DevTagNoiseProps {
  id: string
  type?: string
  children: ReactNode
  tileSize?: number    // Size of repeating pattern tile
  intensity?: number   // How visible (0.01 = very subtle, 0.1 = visible)
  disabled?: boolean
}

export function DevTagNoise({
  id,
  type = 'component',
  children,
  tileSize = 16,
  intensity = 0.04,
  disabled = false
}: DevTagNoiseProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const parent = useContext(NoiseCtx)

  const currentPath = [...parent.path, id]
  const pathString = currentPath.join('/')

  const isDev = process.env.NODE_ENV === 'development'

  useEffect(() => {
    if (!isDev || disabled || !containerRef.current) return

    // Generate pattern data
    const data = JSON.stringify({ p: pathString, t: type, d: parent.depth + 1 })
    const patternUrl = patternToDataURL(data, tileSize, intensity)

    // Apply as repeating background
    containerRef.current.style.backgroundImage = `url(${patternUrl})`
    containerRef.current.style.backgroundRepeat = 'repeat'

    return () => {
      if (containerRef.current) {
        containerRef.current.style.backgroundImage = ''
      }
    }
  }, [pathString, type, parent.depth, tileSize, intensity, isDev, disabled])

  if (!isDev || disabled) {
    return <>{children}</>
  }

  return (
    <NoiseCtx.Provider value={{ path: currentPath, depth: parent.depth + 1 }}>
      <div
        ref={containerRef}
        data-devtag-noise={id}
        data-devtag-path={pathString}
        style={{ position: 'relative' }}
      >
        {children}
      </div>
    </NoiseCtx.Provider>
  )
}

export function DevTagNoiseRoot({
  pageId,
  children,
  intensity = 0.03
}: {
  pageId: string
  children: ReactNode
  intensity?: number
}) {
  return (
    <DevTagNoise id={pageId} type="page" intensity={intensity}>
      {children}
    </DevTagNoise>
  )
}

/**
 * Decoder function - extract pattern from image region and match against known patterns
 * This would scan an image region, extract the repeating tile, hash it, and look up the path
 */
export function decodeNoisePattern(
  imageData: ImageData,
  tileSize: number = 16
): string | null {
  // Extract the first tile
  const tile: number[] = []
  for (let y = 0; y < tileSize && y < imageData.height; y++) {
    for (let x = 0; x < tileSize && x < imageData.width; x++) {
      const idx = (y * imageData.width + x) * 4
      // Use grayscale value
      const gray = (imageData.data[idx] + imageData.data[idx + 1] + imageData.data[idx + 2]) / 3
      tile.push(Math.round(gray))
    }
  }

  // Hash the tile pattern
  const tileHash = hash(tile.join(','))

  // In production, you'd look this up in a registry
  // For now, return the hash for matching
  return `pattern:${tileHash.toString(16)}`
}

export type { DevTagNoiseProps }
