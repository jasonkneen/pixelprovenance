/**
 * DevTagQR - Tiny QR codes that survive any scaling
 *
 * Each component gets a small QR code in its corner encoding the full path.
 * QR codes are designed to survive scaling, rotation, and partial damage.
 */

import { useEffect, useRef, createContext, useContext, type ReactNode } from 'react'
import * as QRCode from 'qrcode'

// Context for hierarchical paths
interface DevTagQRContext {
  path: string[]
  depth: number
}

const QRContext = createContext<DevTagQRContext>({ path: [], depth: 0 })

interface DevTagQRProps {
  id: string
  type?: string
  children: ReactNode
  showQR?: boolean  // Can toggle visibility
  qrSize?: number   // Size in pixels
  qrPosition?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
  qrOpacity?: number
}

/**
 * Generate QR code as data URL
 */
async function generateQR(data: string, size: number): Promise<string> {
  try {
    return await QRCode.toDataURL(data, {
      width: size,
      margin: 0,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#ffffff00' // Transparent background
      }
    })
  } catch {
    return ''
  }
}

/**
 * DevTagQR - Wrap components to add QR code identification
 */
export function DevTagQR({
  id,
  type = 'component',
  children,
  showQR = true,
  qrSize = 20, // Minimum ~18px for reliable Retina scanning
  qrPosition = 'top-right',
  qrOpacity = 1.0 // Full opacity for reliable scanning
}: DevTagQRProps) {
  const canvasRef = useRef<HTMLImageElement>(null)
  const parent = useContext(QRContext)

  // Build path
  const currentPath = [...parent.path, id]
  const pathString = currentPath.join('/')

  // Only render in development
  const isDev = process.env.NODE_ENV === 'development'

  useEffect(() => {
    if (!isDev || !showQR || !canvasRef.current) return

    // Generate QR with path data
    const data = JSON.stringify({
      p: pathString,      // path
      t: type,            // type
      d: parent.depth + 1 // depth
    })

    generateQR(data, qrSize * 2).then(url => {
      if (canvasRef.current) {
        canvasRef.current.src = url
      }
    })
  }, [pathString, type, parent.depth, qrSize, isDev, showQR])

  if (!isDev) {
    return <>{children}</>
  }

  const positionStyles: Record<string, React.CSSProperties> = {
    'top-right': { top: 2, right: 2 },
    'top-left': { top: 2, left: 2 },
    'bottom-right': { bottom: 2, right: 2 },
    'bottom-left': { bottom: 2, left: 2 }
  }

  return (
    <QRContext.Provider value={{ path: currentPath, depth: parent.depth + 1 }}>
      <div
        style={{ position: 'relative' }}
        data-devtag-qr={id}
        data-devtag-path={pathString}
      >
        {children}
        {showQR && (
          <img
            ref={canvasRef}
            alt=""
            style={{
              position: 'absolute',
              width: qrSize,
              height: qrSize,
              opacity: qrOpacity,
              pointerEvents: 'none',
              zIndex: 9999,
              ...positionStyles[qrPosition]
            }}
          />
        )}
      </div>
    </QRContext.Provider>
  )
}

/**
 * Root wrapper for page
 */
export function DevTagQRRoot({
  pageId,
  children,
  showQR = true
}: {
  pageId: string
  children: ReactNode
  showQR?: boolean
}) {
  return (
    <DevTagQR id={pageId} type="page" showQR={showQR} qrSize={20}>
      {children}
    </DevTagQR>
  )
}

export type { DevTagQRProps, DevTagQRContext }
