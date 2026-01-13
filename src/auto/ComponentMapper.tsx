/**
 * DevTag Global Overlay
 *
 * Single overlay component that auto-detects React components via fiber tree
 * and renders invisible patterns in the correct regions.
 *
 * User adds NOTHING to their components - this just works.
 */

import { useEffect, useRef, useState } from 'react'

interface ComponentBounds {
  path: string
  type: string
  depth: number
  rect: DOMRect
  file?: string
  startLine?: number
  endLine?: number
}

/**
 * Find React fiber from DOM element
 */
function getFiber(element: Element): any {
  const keys = Object.keys(element)
  const fiberKey = keys.find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternal'))
  return fiberKey ? (element as any)[fiberKey] : null
}

/**
 * Get component name from fiber
 */
function getComponentName(fiber: any): string | null {
  if (!fiber?.type) return null
  if (typeof fiber.type === 'string') return fiber.type
  return fiber.type.displayName || fiber.type.name || null
}

/**
 * Walk up fiber tree to build path
 */
function buildPath(fiber: any): string[] {
  const path: string[] = []
  let current = fiber

  while (current) {
    const name = getComponentName(current)
    if (name && name !== name.toLowerCase()) {
      // Only track components (PascalCase), not HTML elements
      path.unshift(name)
    }
    current = current.return
  }

  return path
}

/**
 * Load source map if available
 */
function loadSourceMap(): Record<string, { file: string; startLine: number; endLine: number }> | null {
  const sourceMap = (window as any).__DEVTAG_SOURCES__
  if (!sourceMap) return null

  const map: Record<string, any> = {}
  for (const entry of sourceMap) {
    map[entry.name] = {
      file: entry.file,
      startLine: entry.startLine,
      endLine: entry.endLine
    }
  }
  return map
}

/**
 * Scan all elements and extract component bounds
 */
function scanComponentBounds(): ComponentBounds[] {
  const sourceMap = loadSourceMap()
  const bounds: ComponentBounds[] = []
  const seen = new Set<string>()

  // Find all elements with React fibers
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    null
  )

  let elementsChecked = 0
  let fibersFound = 0
  let componentsFound = 0

  let node: Node | null
  while ((node = walker.nextNode())) {
    if (!(node instanceof Element)) continue
    elementsChecked++

    const domFiber = getFiber(node)
    if (!domFiber) continue
    fibersFound++

    // Walk UP the fiber tree to find the first function component
    let componentFiber = domFiber.return
    while (componentFiber) {
      const name = getComponentName(componentFiber)
      if (name && name !== name.toLowerCase()) {
        // Found a component (PascalCase name)
        componentsFound++

        const path = buildPath(componentFiber)
        const pathString = path.join('/')

        if (!seen.has(pathString)) {
          seen.add(pathString)

          const rect = node.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) {
            const sourceInfo = sourceMap?.[name]
            bounds.push({
              path: pathString,
              type: inferType(name),
              depth: path.length,
              rect,
              file: sourceInfo?.file,
              startLine: sourceInfo?.startLine,
              endLine: sourceInfo?.endLine,
            })
          }
        }
        break // Found component for this element
      }
      componentFiber = componentFiber.return
    }
  }

  if (bounds.length === 0) {
    console.debug('[DevTag] Scan debug:', {
      elementsChecked,
      fibersFound,
      componentsFound,
      boundsAdded: bounds.length
    })
  }

  return bounds
}

function inferType(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('button') || lower.includes('btn')) return 'button'
  if (lower.includes('modal')) return 'modal'
  if (lower.includes('panel') || lower.includes('card')) return 'panel'
  if (lower.includes('page')) return 'page'
  return 'component'
}

/**
 * Hash function for pattern generation
 */
function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return h >>> 0
}

/**
 * Generate pattern canvas for a component
 */
function generatePattern(pathString: string, width: number, height: number, intensity: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const seed = hash(pathString)
  const freq1 = 2 + (seed % 5)
  const freq2 = 6 + ((seed >> 8) % 5)

  const imageData = ctx.createImageData(width, height)
  const pixels = imageData.data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const val = Math.sin((x / width) * freq1 * Math.PI * 2) * 0.5 +
                  Math.sin((y / height) * freq2 * Math.PI * 2) * 0.5
      const gray = 245 + Math.floor(val * intensity * 255)

      pixels[idx] = gray
      pixels[idx + 1] = gray
      pixels[idx + 2] = gray
      pixels[idx + 3] = 20 // Low alpha for subtlety
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * DevTag Overlay Component
 * Renders invisible patterns over detected components
 */
export function ComponentMapper({ intensity = 0.15 }: { intensity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [bounds, setBounds] = useState<ComponentBounds[]>([])

  useEffect(() => {
    // Scan component bounds every 500ms
    const interval = setInterval(() => {
      const detected = scanComponentBounds()
      setBounds(detected)

      // Export registry with source locations
      ;(window as any).__DEVTAG_REGISTRY__ = detected.map(b => ({
        path: b.path,
        type: b.type,
        depth: b.depth,
        file: b.file,
        startLine: b.startLine,
        endLine: b.endLine,
      }))

      if (detected.length > 0) {
        console.log('[DevTag] Found', detected.length, 'components:', detected.map(d => d.path))
      }
    }, 500)

    // Initial immediate scan
    const initial = scanComponentBounds()
    if (initial.length > 0) {
      setBounds(initial)
      ;(window as any).__DEVTAG_REGISTRY__ = initial.map(b => ({
        path: b.path,
        type: b.type,
        depth: b.depth,
        file: b.file,
        startLine: b.startLine,
        endLine: b.endLine,
      }))
      console.log('[DevTag] Initial scan:', initial.length, 'components')
    } else {
      console.warn('[DevTag] Initial scan found 0 components - fiber tree may not be ready')
    }

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || bounds.length === 0) return

    const ctx = canvas.getContext('2d')!
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Render pattern for each component region
    for (const component of bounds) {
      const { rect, path } = component

      // Generate small tile and repeat it
      const tileSize = 64
      const pattern = generatePattern(path, tileSize, tileSize, intensity)

      const img = new Image()
      img.onload = () => {
        const pat = ctx.createPattern(img, 'repeat')
        if (pat) {
          ctx.save()
          ctx.translate(rect.left, rect.top)
          ctx.fillStyle = pat
          ctx.globalAlpha = 0.15
          ctx.fillRect(0, 0, rect.width, rect.height)
          ctx.restore()
        }
      }
      img.src = pattern
    }
  }, [bounds, intensity])

  if (process.env.NODE_ENV !== 'development') {
    return null
  }

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 999999,
      }}
    />
  )
}
