import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { toCanvas } from 'html-to-image'

import { DevTag, DevTagRoot } from './DevTag.js'
import {
  analyzeScreenshot,
  type ScreenshotMatch,
} from './demo-analysis.js'
import {
  getDemoSourceSnippet,
  highlightTsxLine,
} from './demo-source.js'
import type { ComponentDescriptor } from './pattern.js'

const SIGNAL_INTENSITY = 0.08
const MATCH_THRESHOLD = 0.42
const LEAF_PATTERN_SIZE = 32
/** Minimum crop edge so one full signal tile (64px) fits with a little slack. */
const MIN_SELECTION_PX = 72
const MAX_CAPTURE_PIXELS = 8_000_000

/**
 * Hierarchical codebook: each entry is a known embedding.
 * Encode (DevTag source=) and decode (this list) must use the same
 * path/type/depth/source so the noise seeds match.
 */
const COMPONENTS: ComponentDescriptor[] = [
  {
    path: 'MORROW_DASHBOARD/workspace-nav',
    type: 'navigation',
    depth: 2,
    source: {
      file: 'src/features/dashboard/WorkspaceNav.tsx',
      line: 18,
      column: 7,
    },
  },
  {
    path: 'MORROW_DASHBOARD/workspace-nav/nav-overview',
    type: 'nav-item',
    depth: 3,
    patternSize: LEAF_PATTERN_SIZE,
    source: {
      file: 'src/features/dashboard/WorkspaceNav.tsx',
      line: 28,
      column: 9,
    },
  },
  {
    path: 'MORROW_DASHBOARD/workspace-nav/nav-projects',
    type: 'nav-item',
    depth: 3,
    patternSize: LEAF_PATTERN_SIZE,
    source: {
      file: 'src/features/dashboard/WorkspaceNav.tsx',
      line: 34,
      column: 9,
    },
  },
  {
    path: 'MORROW_DASHBOARD/progress-summary',
    type: 'metric-card',
    depth: 2,
    source: {
      file: 'src/features/dashboard/ProgressSummary.tsx',
      line: 26,
      column: 5,
    },
  },
  {
    path: 'MORROW_DASHBOARD/open-tasks',
    type: 'metric-card',
    depth: 2,
    source: {
      file: 'src/features/dashboard/OpenTasksStat.tsx',
      line: 14,
      column: 5,
    },
  },
  {
    path: 'MORROW_DASHBOARD/team-focus',
    type: 'metric-card',
    depth: 2,
    source: {
      file: 'src/features/dashboard/TeamFocusStat.tsx',
      line: 14,
      column: 5,
    },
  },
  {
    path: 'MORROW_DASHBOARD/sprint-overview',
    type: 'project-card',
    depth: 2,
    source: {
      file: 'src/features/dashboard/SprintOverview.tsx',
      line: 41,
      column: 5,
    },
  },
  {
    path: 'MORROW_DASHBOARD/sprint-overview/pill-research',
    type: 'chip',
    depth: 3,
    patternSize: LEAF_PATTERN_SIZE,
    source: {
      file: 'src/features/dashboard/SprintOverview.tsx',
      line: 58,
      column: 11,
    },
  },
  {
    path: 'MORROW_DASHBOARD/sprint-overview/pill-design-system',
    type: 'chip',
    depth: 3,
    patternSize: LEAF_PATTERN_SIZE,
    source: {
      file: 'src/features/dashboard/SprintOverview.tsx',
      line: 61,
      column: 11,
    },
  },
  {
    path: 'MORROW_DASHBOARD/sprint-overview/pill-handoff',
    type: 'chip',
    depth: 3,
    patternSize: LEAF_PATTERN_SIZE,
    source: {
      file: 'src/features/dashboard/SprintOverview.tsx',
      line: 64,
      column: 11,
    },
  },
  {
    path: 'MORROW_DASHBOARD/activity-feed',
    type: 'activity-panel',
    depth: 2,
    source: {
      file: 'src/features/dashboard/ActivityFeed.tsx',
      line: 22,
      column: 7,
    },
  },
  {
    path: 'MORROW_DASHBOARD/create-task',
    type: 'button',
    depth: 2,
    source: {
      file: 'src/features/tasks/CreateTaskButton.tsx',
      line: 12,
      column: 7,
    },
  },
]

const COMPONENT_BY_PATH = new Map(
  COMPONENTS.map((component) => [component.path, component]),
)

function embedded(path: string) {
  const component = COMPONENT_BY_PATH.get(path)
  if (!component) {
    throw new Error(`Missing codebook entry for ${path}`)
  }
  return {
    source: component.source,
    patternSize: component.patternSize,
    type: component.type,
  }
}

type AnalysisState =
  | 'idle'
  | 'capturing'
  | 'ready'
  | 'reading'
  | 'matched'
  | 'no-match'
  | 'error'

interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

function SourceLocation({ match }: { match: ScreenshotMatch }) {
  const source = match.component.source
  if (!source) return <span>Source mapping unavailable</span>

  return (
    <code>
      {source.file}
      <strong>:{source.line}:{source.column}</strong>
    </code>
  )
}

function SourceCodePanel({
  match,
  onShowInterface,
}: {
  match: ScreenshotMatch
  onShowInterface: () => void
}) {
  const snippet = getDemoSourceSnippet(match.component.path)
  if (!snippet) return null

  return (
    <section className="source-code-panel" aria-label="Recovered component source code">
      <div className="source-code-heading">
        <div>
          <span>Recovered TSX</span>
          <strong>{snippet.file.split('/').at(-1)}</strong>
        </div>
        <button type="button" onClick={onShowInterface}>
          Show in interface
        </button>
      </div>
      <pre tabIndex={0}>
        <code>
          {snippet.lines.map((line, index) => {
            const lineNumber = snippet.startLine + index
            const isHighlighted = lineNumber === snippet.highlightLine
            return (
              <span
                className="source-code-line"
                data-highlighted={isHighlighted}
                key={lineNumber}
              >
                <b>{lineNumber}</b>
                <span>{highlightTsxLine(line)}</span>
              </span>
            )
          })}
        </code>
      </pre>
      <p>
        That file:line:column was hashed into the frequency pattern for this
        region. Line {snippet.highlightLine} is what the noise decoded to.
      </p>
    </section>
  )
}

function PathBreadcrumb({ path }: { path: string }) {
  const segments = path.split('/').filter(Boolean)
  return (
    <ol
      className="path-breadcrumb"
      aria-label="Component path hierarchy"
      data-path={path}
    >
      {segments.map((segment, index) => (
        <li key={`${segment}-${index}`} data-leaf={index === segments.length - 1}>
          {segment}
        </li>
      ))}
    </ol>
  )
}

function BrandMark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" className="brand-mark">
      <path d="M5 26V10l13 8 13-8v16L18 18 5 26Z" />
    </svg>
  )
}

export default function App() {
  const [showBounds, setShowBounds] = useState(false)
  const [analysisState, setAnalysisState] = useState<AnalysisState>('idle')
  const [matches, setMatches] = useState<ScreenshotMatch[]>([])
  const [captureName, setCaptureName] = useState('')
  const [captureSize, setCaptureSize] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [captureRound, setCaptureRound] = useState<1 | 2>(1)
  const [selection, setSelection] = useState<SelectionRect | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionMessage, setSelectionMessage] = useState('')
  const [pendingPreview, setPendingPreview] = useState('')
  const [showSource, setShowSource] = useState(false)
  const [focusedPath, setFocusedPath] = useState('')
  const [selectionLabel, setSelectionLabel] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const sampleHostRef = useRef<HTMLDivElement>(null)
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null)
  const pendingCaptureRef = useRef<HTMLCanvasElement | null>(null)

  const bestMatch = matches[0]

  function clearSourceFocus() {
    setFocusedPath('')
    setSelectionLabel('')
    setSelection(null)
    setSelectionMessage('')
  }

  async function processCapture(sourceCanvas: HTMLCanvasElement, name: string) {
    setAnalysisState('reading')
    setErrorMessage('')
    setMatches([])
    setShowSource(false)
    clearSourceFocus()
    setCaptureName(name)

    try {
      if (sourceCanvas.width * sourceCanvas.height > MAX_CAPTURE_PIXELS) {
        throw new Error('That capture is too large. Crop one app panel and try again.')
      }

      const canvas = previewCanvasRef.current
      const context = canvas?.getContext('2d', { willReadFrequently: true })
      if (!canvas || !context) {
        throw new Error('This browser could not open the screenshot canvas.')
      }

      canvas.width = sourceCanvas.width
      canvas.height = sourceCanvas.height
      context.drawImage(sourceCanvas, 0, 0)
      setCaptureSize(`${canvas.width} × ${canvas.height}px`)

      await new Promise<void>((resolve) => window.setTimeout(resolve, 80))
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      const ranked = analyzeScreenshot(
        pixels.data,
        canvas.width,
        canvas.height,
        COMPONENTS,
        {
          intensity: SIGNAL_INTENSITY,
          patternSize: 64,
          scales: [1, 2],
          threshold: MATCH_THRESHOLD,
        },
      )
      const match = ranked[0]

      setMatches(ranked)
      if (!match || match.score < MATCH_THRESHOLD) {
        setAnalysisState('no-match')
        return
      }

      context.save()
      context.strokeStyle = '#5265ff'
      context.lineWidth = Math.max(2, canvas.width / 480)
      context.strokeRect(
        match.x + 1,
        match.y + 1,
        match.tileSize - 2,
        match.tileSize - 2,
      )
      context.restore()
      setAnalysisState('matched')
      setShowSource(true)
    } catch (error) {
      setAnalysisState('error')
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function analyzeFile(file: File) {
    clearSourceFocus()
    if (!file.type.startsWith('image/')) {
      setAnalysisState('error')
      setErrorMessage('Choose a PNG, JPEG, or WebP screenshot.')
      return
    }

    setAnalysisState('reading')
    setErrorMessage('')

    try {
      const bitmap = await createImageBitmap(file)
      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = bitmap.width
      sourceCanvas.height = bitmap.height
      const context = sourceCanvas.getContext('2d')
      if (!context) {
        bitmap.close()
        throw new Error('This browser could not open the screenshot canvas.')
      }
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      await processCapture(sourceCanvas, file.name)
    } catch (error) {
      setAnalysisState('error')
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  function pointInSample(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    }
  }

  function normalizedSelection(
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): SelectionRect {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    }
  }

  function selectionMeetsMinimum(area: SelectionRect): boolean {
    return area.width >= MIN_SELECTION_PX && area.height >= MIN_SELECTION_PX
  }

  /** Grow a short drag out to the minimum tile, centered on the drawn box. */
  function snapSelectionToMinimum(
    area: SelectionRect,
    bounds: { width: number; height: number },
  ): { area: SelectionRect; snapped: boolean } {
    if (selectionMeetsMinimum(area)) return { area, snapped: false }

    const width = Math.min(
      Math.max(area.width, MIN_SELECTION_PX),
      bounds.width,
    )
    const height = Math.min(
      Math.max(area.height, MIN_SELECTION_PX),
      bounds.height,
    )
    const centerX = area.x + area.width / 2
    const centerY = area.y + area.height / 2
    const x = Math.max(0, Math.min(bounds.width - width, centerX - width / 2))
    const y = Math.max(0, Math.min(bounds.height - height, centerY - height / 2))

    return {
      area: { x, y, width, height },
      snapped: true,
    }
  }

  function selectionSizeLabel(area: SelectionRect): string {
    const w = Math.round(area.width)
    const h = Math.round(area.height)
    if (selectionMeetsMinimum(area)) return `${w} × ${h} · ready`
    return `${w} × ${h} · need ${MIN_SELECTION_PX}×${MIN_SELECTION_PX}`
  }

  function handleSelectionStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (analysisState === 'capturing') return
    const point = pointInSample(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    selectionStartRef.current = point
    setSelection({ x: point.x, y: point.y, width: 0, height: 0 })
    setSelectionMessage(
      `Drag to at least ${MIN_SELECTION_PX} × ${MIN_SELECTION_PX}px (one signal tile). Short drags snap up on release.`,
    )
    setSelectionLabel('')
    setFocusedPath('')
    setIsSelecting(true)
  }

  function handleSelectionMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = selectionStartRef.current
    if (!isSelecting || !start) return
    const area = normalizedSelection(start, pointInSample(event))
    setSelection(area)
    setSelectionMessage(
      selectionMeetsMinimum(area)
        ? `${Math.round(area.width)} × ${Math.round(area.height)}px — release to capture`
        : `${Math.round(area.width)} × ${Math.round(area.height)}px — too small (min ${MIN_SELECTION_PX}×${MIN_SELECTION_PX}, will snap)`,
    )
  }

  async function prepareInPageCapture(area: SelectionRect) {
    const host = sampleHostRef.current
    const app = host?.querySelector<HTMLElement>('.sample-app')
    if (!host || !app) return

    setAnalysisState('capturing')
    setErrorMessage('')

    try {
      const rendered = await toCanvas(app, {
        backgroundColor: '#f8f7f3',
        cacheBust: true,
        pixelRatio: 1,
        skipFonts: true,
      })
      const scaleX = rendered.width / host.clientWidth
      const scaleY = rendered.height / host.clientHeight
      const crop = document.createElement('canvas')
      crop.width = Math.max(1, Math.round(area.width * scaleX))
      crop.height = Math.max(1, Math.round(area.height * scaleY))
      const context = crop.getContext('2d')
      if (!context) throw new Error('This browser could not prepare the selected crop.')

      context.drawImage(
        rendered,
        Math.round(area.x * scaleX),
        Math.round(area.y * scaleY),
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
      )

      pendingCaptureRef.current = crop
      setPendingPreview(crop.toDataURL('image/png'))
      setCaptureName(`morrow-crop-${captureRound}.png`)
      setCaptureSize(`${crop.width} × ${crop.height}px`)
      setAnalysisState('ready')
      window.setTimeout(() => {
        document.getElementById('analyse')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      }, 120)
    } catch (error) {
      setAnalysisState('error')
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  function handleSelectionEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const start = selectionStartRef.current
    if (!start) return
    const raw = normalizedSelection(start, pointInSample(event))
    selectionStartRef.current = null
    setIsSelecting(false)

    const host = sampleHostRef.current
    const bounds = host
      ? { width: host.clientWidth, height: host.clientHeight }
      : { width: raw.width, height: raw.height }
    const { area, snapped } = snapSelectionToMinimum(raw, bounds)
    setSelection(area)

    if (!selectionMeetsMinimum(area)) {
      setSelectionMessage(
        `Need a ${MIN_SELECTION_PX} × ${MIN_SELECTION_PX} region — the sample surface is too small in one dimension.`,
      )
      return
    }

    if (snapped) {
      setSelectionMessage(
        `Snapped to ${Math.round(area.width)} × ${Math.round(area.height)}px (minimum ${MIN_SELECTION_PX}×${MIN_SELECTION_PX}). Capturing…`,
      )
    } else {
      setSelectionMessage(
        `${Math.round(area.width)} × ${Math.round(area.height)}px — capturing…`,
      )
    }

    void prepareInPageCapture(area)
  }

  function analyzePendingCapture() {
    const capture = pendingCaptureRef.current
    if (capture) void processCapture(capture, captureName)
  }

  function trySmallerCapture() {
    setCaptureRound(2)
    setAnalysisState('idle')
    setMatches([])
    setSelection(null)
    setPendingPreview('')
    setCaptureName('')
    setCaptureSize('')
    setShowSource(false)
    setFocusedPath('')
    setSelectionLabel('')
    pendingCaptureRef.current = null
    window.setTimeout(() => {
      sampleHostRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
  }

  function showMatchInInterface(match: ScreenshotMatch) {
    const host = sampleHostRef.current
    if (!host) return

    const element = Array.from(
      host.querySelectorAll<HTMLElement>('[data-pixelprovenance-path]'),
    ).find(
      (candidate) =>
        candidate.dataset.pixelprovenancePath === match.component.path,
    )
    if (!element) return

    const hostBounds = host.getBoundingClientRect()
    const elementBounds = element.getBoundingClientRect()
    const source = match.component.source
    const focusLabel = source
      ? `Source match · ${source.file.split('/').at(-1)}:${source.line}:${source.column}`
      : 'Recovered component'
    setSelection({
      x: elementBounds.left - hostBounds.left,
      y: elementBounds.top - hostBounds.top,
      width: elementBounds.width,
      height: elementBounds.height,
    })
    setSelectionLabel(focusLabel)
    setSelectionMessage(`${focusLabel}. The originating interface element is selected.`)
    setFocusedPath(match.component.path)
    window.setTimeout(() => {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
  }

  function sourceFocusClass(path: string, className = '') {
    return `${className} ${focusedPath === path ? 'source-focused' : ''}`.trim()
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) void analyzeFile(file)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    if (
      event.dataTransfer.getData('application/x-pixelprovenance-capture') ===
      'pending'
    ) {
      analyzePendingCapture()
      return
    }
    const file = event.dataTransfer.files[0]
    if (file) void analyzeFile(file)
  }

  return (
    <main>
      <header className="site-header">
        <a href="#top" className="site-brand" aria-label="PixelProvenance home">
          <BrandMark />
          <span>PixelProvenance</span>
        </a>
        <nav aria-label="Demo sections">
          <a href="#capture">Capture</a>
          <a href="#analyse">Analyse</a>
          <a href="https://github.com/jasonkneen/pixelprovenance">Source</a>
        </nav>
      </header>

      <section className="hero" id="top">
        <p className="kicker">A screenshot-to-source demo</p>
        <h1>
          Capture a real interface.
          <em>Get the component back.</em>
        </h1>
        <p className="hero-copy">
          Each tagged region embeds its path and source location into a faint
          frequency pattern in the pixels. Crop a card or a single chip; the
          noise itself carries the mapping back to the code.
        </p>
        <a
          className="paper-download"
          href="/pixelprovenance-paper.pdf"
          download
        >
          <span>Research paper · PDF · 15 pages</span>
          <strong>Component identification via frequency-domain encoding</strong>
          <small>Download the paper <b>PDF</b></small>
        </a>
        <div className="hero-proof">
          <span>Encoding is on</span>
          <strong>It should look like an ordinary app.</strong>
        </div>
      </section>

      <section className="capture-section" id="capture">
        <div className="section-intro">
          <p className="step-label">01 / Select pixels</p>
          <h2>
            {captureRound === 1
              ? 'Draw around the sprint card.'
              : 'Now crop a single chip.'}
          </h2>
          <p>
            {captureRound === 1
              ? 'Click and drag over the sample app. Start with the whole outlined card — that recovers the project-card path.'
              : 'Draw around one of the task pills (Research, Design system, Handoff). Nested tags should resolve to that chip’s source line.'}
          </p>
        </div>

        <div className="capture-instructions" aria-label="Selection instructions">
          <div className="selection-instruction">
            <span>{captureRound === 1 ? 'First pass' : 'Tolerance pass'}</span>
            <strong>Press, drag, release</strong>
            <small>
              {captureRound === 1
                ? `Aim for the blue outline · min ${MIN_SELECTION_PX}×${MIN_SELECTION_PX}`
                : `Aim for a task pill · min ${MIN_SELECTION_PX}×${MIN_SELECTION_PX} (snaps if short)`}
            </small>
          </div>
          <label className="bounds-toggle">
            <input
              type="checkbox"
              checked={showBounds}
              onChange={(event) => setShowBounds(event.target.checked)}
            />
            <span />
            Show component bounds
          </label>
        </div>

        <div className="sample-frame">
          <div className="browser-bar">
            <div><i /><i /><i /></div>
            <span>app.morrow.local/dashboard</span>
            <small>Sample application</small>
          </div>

          <div className="sample-app-host" ref={sampleHostRef}>
            <DevTagRoot
              pageId="MORROW_DASHBOARD"
              enabled
              signal={false}
              debug={showBounds}
              intensity={SIGNAL_INTENSITY}
              className={`sample-app ${showBounds ? 'show-bounds' : ''}`}
            >
            <DevTag
              id="workspace-nav"
              {...embedded('MORROW_DASHBOARD/workspace-nav')}
              className={sourceFocusClass(
                'MORROW_DASHBOARD/workspace-nav',
                'sample-sidebar',
              )}
            >
              <div className="app-logo"><BrandMark /><span>Morrow</span></div>
              <div className="workspace-switcher">
                <span>NW</span>
                <div><strong>Northwind Studio</strong><small>12 members</small></div>
                <b>⌄</b>
              </div>
              <nav className="app-nav" aria-label="Sample application">
                <DevTag
                  id="nav-overview"
                  {...embedded('MORROW_DASHBOARD/workspace-nav/nav-overview')}
                  className={sourceFocusClass(
                    'MORROW_DASHBOARD/workspace-nav/nav-overview',
                  )}
                >
                  <a data-active="true" href="#capture"><span>⌂</span>Overview</a>
                </DevTag>
                <DevTag
                  id="nav-projects"
                  {...embedded('MORROW_DASHBOARD/workspace-nav/nav-projects')}
                  className={sourceFocusClass(
                    'MORROW_DASHBOARD/workspace-nav/nav-projects',
                  )}
                >
                  <a href="#capture"><span>□</span>Projects <small>8</small></a>
                </DevTag>
                <a href="#capture"><span>◷</span>Schedule</a>
                <a href="#capture"><span>◇</span>Reports</a>
              </nav>
              <div className="sidebar-footer">
                <span className="avatar">MS</span>
                <div><strong>Maya Shah</strong><small>Product lead</small></div>
              </div>
            </DevTag>

            <div className="sample-main">
              <div className="sample-toolbar">
                <div>
                  <p>Monday, 24 June</p>
                  <h3>Good morning, Maya.</h3>
                </div>
                <DevTag
                  id="create-task"
                  {...embedded('MORROW_DASHBOARD/create-task')}
                  className={sourceFocusClass('MORROW_DASHBOARD/create-task')}
                >
                  <button type="button" className="new-task">New task <span>+</span></button>
                </DevTag>
              </div>

              <div className="sample-content">
                <DevTag
                  id="progress-summary"
                  {...embedded('MORROW_DASHBOARD/progress-summary')}
                  className={sourceFocusClass(
                    'MORROW_DASHBOARD/progress-summary',
                    'progress-summary',
                  )}
                >
                  <div className="metric-heading"><span>Weekly progress</span><small>Jun 24–30</small></div>
                  <div className="metric-value"><strong>72%</strong><span>+8.4%</span></div>
                  <div className="progress-track"><i /></div>
                  <p>18 of 25 planned tasks completed</p>
                </DevTag>

                <DevTag
                  id="open-tasks"
                  {...embedded('MORROW_DASHBOARD/open-tasks')}
                  className={sourceFocusClass(
                    'MORROW_DASHBOARD/open-tasks',
                    'mini-stat coral-card',
                  )}
                >
                  <span>Open tasks</span><strong>07</strong><small>3 due today</small>
                </DevTag>
                <DevTag
                  id="team-focus"
                  {...embedded('MORROW_DASHBOARD/team-focus')}
                  className={sourceFocusClass(
                    'MORROW_DASHBOARD/team-focus',
                    'mini-stat ink-card',
                  )}
                >
                  <span>Team focus</span><strong>84</strong><small>High alignment</small>
                </DevTag>

                <DevTag
                  id="sprint-overview"
                  {...embedded('MORROW_DASHBOARD/sprint-overview')}
                  className={sourceFocusClass(
                    'MORROW_DASHBOARD/sprint-overview',
                    'sprint-card capture-target',
                  )}
                >
                  <div className="capture-callout" id="capture-target">
                    <span>
                      {captureRound === 1 ? 'Start with this card' : 'Crop a nested chip'}
                    </span>
                    <small>
                      {captureRound === 1
                        ? 'Draw around the blue corners'
                        : 'Try Research / Design system / Handoff'}
                    </small>
                  </div>
                  <div className="card-topline"><span>Priority project</span><small>3 days left</small></div>
                  <h4>Summer identity refresh</h4>
                  <p>Finalise the campaign system and prepare the launch handoff.</p>
                  <div className="task-pills">
                    <DevTag
                      id="pill-research"
                      {...embedded('MORROW_DASHBOARD/sprint-overview/pill-research')}
                      className={sourceFocusClass(
                        'MORROW_DASHBOARD/sprint-overview/pill-research',
                        'task-pill',
                      )}
                    >
                      Research
                    </DevTag>
                    <DevTag
                      id="pill-design-system"
                      {...embedded('MORROW_DASHBOARD/sprint-overview/pill-design-system')}
                      className={sourceFocusClass(
                        'MORROW_DASHBOARD/sprint-overview/pill-design-system',
                        'task-pill',
                      )}
                    >
                      Design system
                    </DevTag>
                    <DevTag
                      id="pill-handoff"
                      {...embedded('MORROW_DASHBOARD/sprint-overview/pill-handoff')}
                      className={sourceFocusClass(
                        'MORROW_DASHBOARD/sprint-overview/pill-handoff',
                        'task-pill',
                      )}
                    >
                      Handoff
                    </DevTag>
                  </div>
                  <div className="card-footer">
                    <div className="avatar-stack"><i>JL</i><i>AK</i><i>MS</i></div>
                    <div><b>12 / 16</b><span>tasks complete</span></div>
                  </div>
                </DevTag>

                <DevTag
                  id="activity-feed"
                  {...embedded('MORROW_DASHBOARD/activity-feed')}
                  className={sourceFocusClass(
                    'MORROW_DASHBOARD/activity-feed',
                    'activity-card',
                  )}
                >
                  <div className="activity-heading"><span>Recent activity</span><button type="button">View all</button></div>
                  <ul>
                    <li><i className="dot lavender" /><div><strong>Jon uploaded three campaign concepts</strong><span>Brand refresh · 18 min ago</span></div></li>
                    <li><i className="dot coral" /><div><strong>Ana completed homepage review</strong><span>Website launch · 1 hr ago</span></div></li>
                    <li><i className="dot mint" /><div><strong>Research synthesis is ready</strong><span>Mobile study · 3 hrs ago</span></div></li>
                  </ul>
                </DevTag>
              </div>
            </div>
            </DevTagRoot>
            <div
              className="selection-layer"
              data-selecting={isSelecting}
              data-source-focus={focusedPath ? 'true' : 'false'}
              onPointerDown={handleSelectionStart}
              onPointerMove={handleSelectionMove}
              onPointerUp={handleSelectionEnd}
            >
              {!selection && (
                <div className="selection-cursor-note">
                  <span>Drag to capture</span>
                  <small>The app remains live underneath</small>
                </div>
              )}
              {selection && (
                <div
                  className="selection-rect"
                  data-source-focus={focusedPath ? 'true' : 'false'}
                  data-too-small={
                    !focusedPath && !selectionMeetsMinimum(selection)
                      ? 'true'
                      : 'false'
                  }
                  data-snapping={isSelecting ? 'false' : undefined}
                  style={{
                    left: selection.x,
                    top: selection.y,
                    width: selection.width,
                    height: selection.height,
                  }}
                >
                  <span>
                    {selectionLabel || selectionSizeLabel(selection)}
                  </span>
                </div>
              )}
              {analysisState === 'capturing' && (
                <div className="capture-rendering">Preparing your crop…</div>
              )}
            </div>
          </div>
        </div>

        <div
          className="capture-status"
          data-tone={
            selection && isSelecting && !selectionMeetsMinimum(selection)
              ? 'warn'
              : selectionMessage.includes('Snapped')
                ? 'snap'
                : selectionMessage.includes('too small')
                  ? 'warn'
                  : 'idle'
          }
          aria-live="polite"
        >
          {selectionMessage ||
            `Draw at least ${MIN_SELECTION_PX} × ${MIN_SELECTION_PX}px. Smaller boxes snap up to that size on release.`}
        </div>
      </section>

      <section className="analysis-section" id="analyse">
        <div className="section-intro analysis-intro">
          <p className="step-label">02 / Analyse</p>
          <h2>Drop the captured pixels into analysis.</h2>
          <p>
            The comparison runs locally in your browser against the component
            registry. The screenshot is not uploaded anywhere.
          </p>
        </div>

        {analysisState === 'ready' && pendingPreview && (
          <div className="drag-handoff">
            <button
              className="captured-tray"
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  'application/x-pixelprovenance-capture',
                  'pending',
                )
                event.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={analyzePendingCapture}
            >
              <img src={pendingPreview} alt="The selected sample-app crop" draggable={false} />
              <span>
                <small>Step 1 · Capture ready · {captureSize}</small>
                <strong>Drag this crop into analysis</strong>
              </span>
              <b>Drag to analyse</b>
            </button>
            <div className="drag-route" aria-hidden="true">
              <i /><i /><i />
              <span>↓ Drop into the outlined target below</span>
            </div>
          </div>
        )}

        <div className="analysis-workspace">
          <div
            className="drop-panel"
            data-dragging={isDragging}
            data-has-capture={analysisState !== 'idle'}
            data-ready={analysisState === 'ready'}
            onDragEnter={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileInput}
              aria-label="Choose screenshot for analysis"
            />
            <div className="drop-heading">
              <span>Captured pixels</span>
              {captureSize && <small>{captureName} · {captureSize}</small>}
            </div>
            <div className="preview-shell">
              <canvas ref={previewCanvasRef} />
              {(analysisState === 'idle' || analysisState === 'ready') && (
                <button type="button" onClick={() => fileInputRef.current?.click()}>
                  <span className="upload-arrow">{analysisState === 'ready' ? '2' : 'Add'}</span>
                  <strong>{analysisState === 'ready' ? 'Drop it here to analyse' : 'Drop a cropped screenshot here'}</strong>
                  <small>{analysisState === 'ready' ? 'or click the capture above to analyse it' : 'or choose a PNG, JPEG, or WebP file'}</small>
                </button>
              )}
              {analysisState === 'reading' && (
                <div className="reading-state"><i /><span>Comparing signal frequencies…</span></div>
              )}
            </div>
            {analysisState !== 'idle' && analysisState !== 'ready' && analysisState !== 'reading' && (
              <button className="replace-capture" type="button" onClick={() => fileInputRef.current?.click()}>
                Choose another screenshot
              </button>
            )}
          </div>

          <div className="result-panel" aria-live="polite" data-state={analysisState}>
            <div className="result-heading">
              <span>Registry comparison</span>
              <small>{COMPONENTS.length} mapped components</small>
            </div>

            {analysisState === 'idle' && (
              <div className="empty-result">
                <span>Waiting for a capture</span>
                <p>Your component path, source file, line and character will appear here.</p>
              </div>
            )}

            {analysisState === 'capturing' && (
              <div className="empty-result"><span>Capturing selection</span><p>Rasterising the selected interface pixels locally.</p></div>
            )}

            {analysisState === 'ready' && (
              <div className="empty-result ready-result">
                <span>Your crop is ready</span>
                <p>Drag the thumbnail into the analysis target to start the registry comparison.</p>
              </div>
            )}

            {analysisState === 'reading' && (
              <div className="empty-result"><span>Analysing</span><p>Checking 1× and 2× signal scales.</p></div>
            )}

            {analysisState === 'error' && (
              <div className="empty-result error-result"><span>Could not analyse</span><p>{errorMessage}</p></div>
            )}

            {analysisState === 'no-match' && (
              <div className="empty-result error-result">
                <span>No confident match</span>
                <p>
                  Try another rectangle of at least {MIN_SELECTION_PX} ×{' '}
                  {MIN_SELECTION_PX} pixels over an encoded region (short draws
                  snap to the minimum).
                </p>
                <button type="button" className="retry-button" onClick={trySmallerCapture}>Try another crop</button>
              </div>
            )}

            {analysisState === 'matched' && bestMatch && (
              <>
                <div className="match-summary">
                  <span className="match-status">
                    {bestMatch.component.depth > 2
                      ? 'Nested region recovered'
                      : 'Component recovered'}
                  </span>
                  <PathBreadcrumb path={bestMatch.component.path} />
                  <h3>{bestMatch.component.path.split('/').at(-1)}</h3>
                  <p>
                    {bestMatch.component.type} · depth {bestMatch.component.depth} ·{' '}
                    {(bestMatch.score * 100).toFixed(1)}% correlation
                    {bestMatch.component.patternSize
                      ? ` · ${bestMatch.component.patternSize}px tile`
                      : ''}
                  </p>
                </div>
                <div className="source-result">
                  <div className="source-result-heading">
                    <span>Source mapping</span>
                    <button
                      type="button"
                      aria-expanded={showSource}
                      onClick={() => setShowSource((visible) => !visible)}
                    >
                      {showSource ? 'Hide code' : 'View code'}
                    </button>
                  </div>
                  <SourceLocation match={bestMatch} />
                  <p>embedded in the noise · file · line · character</p>
                </div>
                {showSource && (
                  <SourceCodePanel
                    match={bestMatch}
                    onShowInterface={() => showMatchInInterface(bestMatch)}
                  />
                )}
                <div className="ranking">
                  <span>Hierarchy candidates in this crop</span>
                  {matches.slice(0, 4).map((match, index) => (
                    <div key={match.component.path}>
                      <b>{String(index + 1).padStart(2, '0')}</b>
                      <span title={match.component.path}>
                        {'—'.repeat(Math.max(0, match.component.depth - 2))}
                        {match.component.path.split('/').at(-1)}
                      </span>
                      <i><em style={{ width: `${Math.max(2, match.score * 100)}%` }} /></i>
                      <strong>{(match.score * 100).toFixed(1)}%</strong>
                    </div>
                  ))}
                </div>
                <button type="button" className="retry-button" onClick={trySmallerCapture}>
                  {captureRound === 1 ? 'Try cropping a chip' : 'Capture another area'}
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="explanation-section">
        <p className="step-label">03 / What happened</p>
        <div>
          <h2>The app stayed visually clean. The pixels kept the receipt.</h2>
          <p>
            Each DevTag hashes its path, type, depth, and source location into
            a deterministic frequency pattern in the pixels. Nested tags each
            embed their own mapping. The registry is only the codebook of known
            embeddings to correlate against — the mapping is recovered from the
            noise, not joined on after the fact. Deepest confident match wins.
          </p>
        </div>
      </section>

      <footer>
        <div className="site-brand"><BrandMark /><span>PixelProvenance</span></div>
        <p>Experimental developer tooling. Validate capture thresholds against your own browser and screenshot pipeline.</p>
        <a href="https://github.com/jasonkneen/pixelprovenance">View source</a>
      </footer>
    </main>
  )
}
