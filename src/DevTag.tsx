/**
 * DevTag - Invisible noise patterns with perceptual hashing
 *
 * Generates distinctive noise patterns that survive Retina 2x scaling.
 * Uses perceptual features (not exact pixels) for matching.
 */

import { useEffect, useRef, createContext, useContext, type ReactNode } from 'react'

interface ComponentContext {
  path: string[]
  depth: number
}

const ComponentCtx = createContext<ComponentContext>({ path: [], depth: 0 })

// Deterministic PRNG from seed
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

// Simple hash
function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return h >>> 0
}

/**
 * Generate perceptually distinctive noise pattern
 *
 * Key: The pattern must have distinctive STRUCTURAL features that
 * survive interpolation, not exact pixel values.
 *
 * We create patterns with different spatial frequencies based on the hash.
 */
function generatePerceptualPattern(
  data: string,
  width: number,
  height: number,
  intensity: number = 0.08
): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const imageData = ctx.createImageData(width, height)
  const pixels = imageData.data

  const seed = hash(data)
  const rng = new SeededRandom(seed)

  // Generate 3 different frequency components based on seed
  const freq1 = 2 + (seed % 5)        // Low freq
  const freq2 = 6 + ((seed >> 8) % 5) // Mid freq
  const freq3 = 12 + ((seed >> 16) % 6) // High freq

  const phase1 = rng.next() * Math.PI * 2
  const phase2 = rng.next() * Math.PI * 2
  const phase3 = rng.next() * Math.PI * 2

  const amp1 = 0.4 + rng.next() * 0.3
  const amp2 = 0.3 + rng.next() * 0.3
  const amp3 = 0.3 + rng.next() * 0.2

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4

      // Combine multiple frequency components for distinctive pattern
      const val1 = Math.sin((x / width) * freq1 * Math.PI * 2 + phase1) * amp1
      const val2 = Math.sin((y / height) * freq2 * Math.PI * 2 + phase2) * amp2
      const val3 = Math.sin((x / width + y / height) * freq3 * Math.PI * 2 + phase3) * amp3

      const combined = (val1 + val2 + val3) / 3

      // Apply as subtle variation
      const variation = Math.floor(combined * intensity * 255)
      const gray = 245 + variation // Light gray base

      pixels[idx] = gray
      pixels[idx + 1] = gray
      pixels[idx + 2] = gray
      pixels[idx + 3] = 15 // Very low alpha for subtlety
    }
  }

  return imageData
}

interface DevTagProps {
  id: string
  type?: string
  children: ReactNode
  patternSize?: number
  intensity?: number
  disabled?: boolean
}

export function DevTag({
  id,
  type = 'component',
  children,
  patternSize = 64,
  intensity = 0.08,
  disabled = false
}: DevTagProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const parent = useContext(ComponentCtx)

  const currentPath = [...parent.path, id]
  const pathString = currentPath.join('/')

  const isDev = process.env.NODE_ENV === 'development'

  useEffect(() => {
    if (!isDev || disabled || !containerRef.current) return

    const data = JSON.stringify({ p: pathString, t: type, d: parent.depth + 1 })

    // Generate pattern
    const imageData = generatePerceptualPattern(data, patternSize, patternSize, intensity)

    // Convert to data URL
    const canvas = document.createElement('canvas')
    canvas.width = patternSize
    canvas.height = patternSize
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(imageData, 0, 0)
    const dataUrl = canvas.toDataURL('image/png')

    // Apply as repeating background
    containerRef.current.style.backgroundImage = `url(${dataUrl})`
    containerRef.current.style.backgroundRepeat = 'repeat'
    containerRef.current.style.backgroundSize = `${patternSize}px ${patternSize}px`

    return () => {
      if (containerRef.current) {
        containerRef.current.style.backgroundImage = ''
      }
    }
  }, [pathString, type, parent.depth, patternSize, intensity, isDev, disabled])

  if (!isDev || disabled) {
    return <>{children}</>
  }

  return (
    <ComponentCtx.Provider value={{ path: currentPath, depth: parent.depth + 1 }}>
      <div
        ref={containerRef}
        data-devtag-perceptual={id}
        data-devtag-path={pathString}
        style={{ position: 'relative' }}
      >
        {children}
      </div>
    </ComponentCtx.Provider>
  )
}

export function DevTagRoot({
  pageId,
  children,
  intensity = 0.06
}: {
  pageId: string
  children: ReactNode
  intensity?: number
}) {
  return (
    <DevTag id={pageId} type="page" intensity={intensity}>
      {children}
    </DevTag>
  )
}

export type { DevTagProps }
