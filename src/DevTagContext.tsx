/**
 * DevTag Hierarchical Context System
 *
 * Components wrap their children with DevTagScope, building a tree.
 * Each component's shadow encodes only its ID + parent reference.
 * The decoder reconstructs the full path: Page > Panel > Button
 */

import {
  createContext,
  useContext,
  useRef,
  useEffect,
  type ReactNode
} from 'react'

// Hierarchical scope context
interface DevTagScopeData {
  id: string           // This component's ID
  type: string         // Component type (page, panel, button, etc.)
  parentId?: string    // Parent's ID (for reconstruction)
  depth: number        // Nesting depth
  path: string[]       // Full path from root
}

const DevTagContext = createContext<DevTagScopeData | null>(null)

// Magic bytes "PXPV" (PixelProvenance)
const MAGIC = [0x50, 0x58, 0x50, 0x56]
const VERSION = 2

function stringToBytes(str: string): number[] {
  return Array.from(new TextEncoder().encode(str))
}

function buildHierarchicalPayload(scope: DevTagScopeData): number[] {
  const bytes: number[] = []

  // Magic
  bytes.push(...MAGIC)

  // Version
  bytes.push(VERSION)

  // Depth (1 byte)
  bytes.push(scope.depth)

  // Type length + type
  const typeBytes = stringToBytes(scope.type)
  bytes.push(typeBytes.length)
  bytes.push(...typeBytes)

  // ID length + ID
  const idBytes = stringToBytes(scope.id)
  bytes.push(idBytes.length)
  bytes.push(...idBytes)

  // Parent ID length + parent ID (0 if root)
  const parentBytes = scope.parentId ? stringToBytes(scope.parentId) : []
  bytes.push(parentBytes.length)
  bytes.push(...parentBytes)

  // Full path (for redundancy) - joined with /
  const pathStr = scope.path.join('/')
  const pathBytes = stringToBytes(pathStr)
  bytes.push((pathBytes.length >> 8) & 0xff)
  bytes.push(pathBytes.length & 0xff)
  bytes.push(...pathBytes)

  // Checksum
  const checksum = bytes.reduce((acc, b) => acc ^ b, 0)
  bytes.push(checksum)

  return bytes
}

function renderShadowWithHierarchy(
  canvas: HTMLCanvasElement,
  scope: DevTagScopeData,
  width: number,
  height: number
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  canvas.width = width
  canvas.height = height

  // Draw natural shadow gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.12)')
  gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.06)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  // Encode payload into LSB
  const payload = buildHierarchicalPayload(scope)
  const bits: number[] = []
  for (const byte of payload) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1)
    }
  }

  const imageData = ctx.getImageData(0, 0, width, height)
  const pixels = imageData.data

  // Encode in RGB LSBs (not alpha - alpha gets flattened in screenshots)
  // Use row 0, encode 1 bit per color channel (3 bits per pixel)
  let bitIndex = 0
  for (let x = 0; x < width && bitIndex < bits.length; x++) {
    const idx = x * 4 // Row 0
    // Encode in R, G, B LSBs
    if (bitIndex < bits.length) pixels[idx] = (pixels[idx] & 0xFE) | bits[bitIndex++]
    if (bitIndex < bits.length) pixels[idx + 1] = (pixels[idx + 1] & 0xFE) | bits[bitIndex++]
    if (bitIndex < bits.length) pixels[idx + 2] = (pixels[idx + 2] & 0xFE) | bits[bitIndex++]
  }

  // Repeat in middle and last row for redundancy
  for (const row of [Math.floor(height / 2), height - 1]) {
    bitIndex = 0
    for (let x = 0; x < width && bitIndex < bits.length; x++) {
      const idx = (row * width + x) * 4
      if (bitIndex < bits.length) pixels[idx] = (pixels[idx] & 0xFE) | bits[bitIndex++]
      if (bitIndex < bits.length) pixels[idx + 1] = (pixels[idx + 1] & 0xFE) | bits[bitIndex++]
      if (bitIndex < bits.length) pixels[idx + 2] = (pixels[idx + 2] & 0xFE) | bits[bitIndex++]
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

// Props for DevTagScope
interface DevTagScopeProps {
  id: string
  type: string
  children: ReactNode
  shadowHeight?: number
  shadowPosition?: 'before' | 'after' | 'both'
}

/**
 * DevTagScope - Wrap components to add them to the hierarchy
 *
 * @example
 * <DevTagScope id="billing-panel" type="panel">
 *   <Panel>
 *     <DevTagScope id="submit-btn" type="button">
 *       <Button>Submit</Button>
 *     </DevTagScope>
 *   </Panel>
 * </DevTagScope>
 */
export function DevTagScope({
  id,
  type,
  children,
  shadowHeight = 8,
  shadowPosition = 'after'
}: DevTagScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const parent = useContext(DevTagContext)

  // Build scope data
  const scope: DevTagScopeData = {
    id,
    type,
    parentId: parent?.id,
    depth: (parent?.depth ?? -1) + 1,
    path: [...(parent?.path ?? []), id]
  }

  // Only render in development
  const isDev = process.env.NODE_ENV === 'development'

  useEffect(() => {
    if (!isDev) return
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const width = container.clientWidth || 200
    renderShadowWithHierarchy(canvas, scope, width, shadowHeight)
  }, [id, type, shadowHeight, isDev, scope])

  if (!isDev) {
    return <>{children}</>
  }

  const shadowCanvas = (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width: '100%',
        height: `${shadowHeight}px`,
        pointerEvents: 'none',
      }}
      data-devtag-scope={id}
      data-devtag-type={type}
      data-devtag-path={scope.path.join('/')}
      aria-hidden="true"
    />
  )

  return (
    <DevTagContext.Provider value={scope}>
      <div ref={containerRef} data-devtag-container={id}>
        {shadowPosition === 'before' || shadowPosition === 'both' ? shadowCanvas : null}
        {children}
        {shadowPosition === 'after' || shadowPosition === 'both' ? shadowCanvas : null}
      </div>
    </DevTagContext.Provider>
  )
}

/**
 * Hook to get current scope
 */
export function useDevTagScope(): DevTagScopeData | null {
  return useContext(DevTagContext)
}

/**
 * Root provider for page-level context
 */
export function DevTagRoot({
  pageId,
  children
}: {
  pageId: string
  children: ReactNode
}) {
  return (
    <DevTagScope id={pageId} type="page">
      {children}
    </DevTagScope>
  )
}

export type { DevTagScopeData, DevTagScopeProps }
