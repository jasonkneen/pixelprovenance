import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

import {
  clampIntensity,
  clampPatternSize,
  createPatternPayload,
  generatePatternRgba,
  type SourceLocation,
} from './pattern.js'

interface ComponentContextValue {
  path: string[]
  depth: number
  enabled: boolean
  intensity: number
  patternSize: number
  debug: boolean
}

const ComponentContext = createContext<ComponentContextValue>({
  path: [],
  depth: 0,
  enabled: true,
  intensity: 0.08,
  patternSize: 64,
  debug: false,
})

const patternUrlCache = new Map<string, string>()
const MAX_CACHED_PATTERN_URLS = 128

function isDevelopmentBuild(): boolean {
  if (typeof process !== 'undefined' && process.env.NODE_ENV) {
    return process.env.NODE_ENV !== 'production'
  }

  const viteEnvironment = (import.meta as ImportMeta & {
    env?: { DEV?: boolean }
  }).env
  if (typeof viteEnvironment?.DEV === 'boolean') return viteEnvironment.DEV

  return false
}

function createPatternDataUrl(
  payload: string,
  patternSize: number,
  intensity: number,
): string | null {
  if (typeof document === 'undefined') return null

  const cacheKey = `${payload}\u0000${patternSize}\u0000${intensity}`
  const cached = patternUrlCache.get(cacheKey)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = patternSize
  canvas.height = patternSize

  const context = canvas.getContext('2d')
  if (!context) return null

  const imageData = context.createImageData(patternSize, patternSize)
  imageData.data.set(generatePatternRgba(payload, patternSize, intensity))
  context.putImageData(imageData, 0, 0)
  const dataUrl = canvas.toDataURL('image/png')
  if (patternUrlCache.size >= MAX_CACHED_PATTERN_URLS) {
    const oldestKey = patternUrlCache.keys().next().value
    if (oldestKey !== undefined) patternUrlCache.delete(oldestKey)
  }
  patternUrlCache.set(cacheKey, dataUrl)
  return dataUrl
}

export interface DevTagProps {
  /** Stable identifier used as one segment of the decoded component path. */
  id: string
  /** Human-readable category included in the pattern payload. */
  type?: string
  /**
   * Source location embedded into the noise. Must match the registry entry
   * used at decode time — the mapping is part of the pattern seed, not a
   * side-channel lookup after path match.
   */
  source?: SourceLocation
  children: ReactNode
  /** CSS size of the repeating signal tile. Values are clamped to 16-256. */
  patternSize?: number
  /** Signal strength from 0-1. Practical screenshot values are 0.05-0.12. */
  intensity?: number
  /** Overrides environment detection. Useful for tests and explicit builds. */
  enabled?: boolean
  /** @deprecated Use `enabled={false}`. A true value always disables the tag. */
  disabled?: boolean
  /** Draws the tagged region border for inspection. */
  debug?: boolean
  /** Paints this tag's signal. Disable on a context-only root wrapper. */
  signal?: boolean
  className?: string
  style?: CSSProperties
}

/**
 * Tags a rectangular React region with a deterministic, screenshot-readable
 * frequency pattern. The path, type, depth, and optional source location are
 * hashed into the carrier. Nested tags automatically build hierarchical paths,
 * each with its own embedded mapping.
 */
export function DevTag({
  id,
  type = 'component',
  source,
  children,
  patternSize,
  intensity,
  enabled,
  disabled = false,
  debug,
  signal = true,
  className,
  style,
}: DevTagProps) {
  const parent = useContext(ComponentContext)
  const currentPath = useMemo(() => [...parent.path, id], [parent.path, id])
  const path = currentPath.join('/')
  const depth = parent.depth + 1
  const isRootTag = parent.path.length === 0
  const requestedEnabled = disabled ? false : enabled
  const isEnabled = isRootTag
    ? (requestedEnabled ?? isDevelopmentBuild())
    : parent.enabled && (requestedEnabled ?? true)
  const safeSize = clampPatternSize(patternSize ?? parent.patternSize)
  const safeIntensity = clampIntensity(intensity ?? parent.intensity)
  const isDebug = debug ?? parent.debug
  const payload = createPatternPayload({ path, type, depth, source })
  const [patternUrl, setPatternUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!isEnabled || !signal) {
      setPatternUrl(null)
      return
    }

    setPatternUrl(createPatternDataUrl(payload, safeSize, safeIntensity))
  }, [isEnabled, payload, safeIntensity, safeSize, signal])

  const contextValue = useMemo<ComponentContextValue>(
    () => ({
      path: currentPath,
      depth,
      enabled: isEnabled,
      intensity: safeIntensity,
      patternSize: safeSize,
      debug: isDebug,
    }),
    [currentPath, depth, isDebug, isEnabled, safeIntensity, safeSize],
  )

  if (!isEnabled) {
    return (
      <ComponentContext.Provider value={contextValue}>
        {className || style ? (
          <div className={className} style={{ position: 'relative', ...style }}>
            {children}
          </div>
        ) : children}
      </ComponentContext.Provider>
    )
  }

  return (
    <ComponentContext.Provider value={contextValue}>
      <div
        className={className}
        data-pixelprovenance-id={id}
        data-pixelprovenance-path={path}
        data-pixelprovenance-type={type}
        data-pixelprovenance-source={
          source ? `${source.file}:${source.line}:${source.column}` : undefined
        }
        style={{ position: 'relative', ...style }}
      >

        {children}
        {signal && (
          <span
            aria-hidden="true"
            data-pixelprovenance-signal=""
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 20 + depth,
              pointerEvents: 'none',
              border: isDebug ? '1px solid rgba(82, 101, 255, 0.85)' : 0,
              backgroundImage: patternUrl ? `url(${patternUrl})` : undefined,
              backgroundRepeat: 'repeat',
              backgroundPosition: '0 0',
              backgroundSize: `${safeSize}px ${safeSize}px`,
            }}
          />
        )}
      </div>
    </ComponentContext.Provider>
  )
}

export interface DevTagRootProps {
  pageId: string
  children: ReactNode
  /** Optional source embedded in the root page signal when `signal` is on. */
  source?: SourceLocation
  intensity?: number
  patternSize?: number
  enabled?: boolean
  debug?: boolean
  signal?: boolean
  className?: string
  style?: CSSProperties
}

export function DevTagRoot({
  pageId,
  children,
  source,
  intensity = 0.06,
  patternSize = 64,
  enabled,
  debug,
  signal,
  className,
  style,
}: DevTagRootProps) {
  return (
    <DevTag
      id={pageId}
      type="page"
      source={source}
      intensity={intensity}
      patternSize={patternSize}
      enabled={enabled}
      debug={debug}
      signal={signal}
      className={className}
      style={style}
    >
      {children}
    </DevTag>
  )
}
