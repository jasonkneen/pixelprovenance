/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  analyzeScreenshot: vi.fn(),
  toCanvas: vi.fn(),
}))

vi.mock('html-to-image', () => ({ toCanvas: mocks.toCanvas }))
vi.mock('./demo-analysis.js', () => ({
  analyzeScreenshot: mocks.analyzeScreenshot,
}))

import App from './demo.js'

const MATCH = {
  component: {
    path: 'MORROW_DASHBOARD/sprint-overview',
    type: 'project-card',
    depth: 2,
    source: {
      file: 'src/features/dashboard/SprintOverview.tsx',
      line: 41,
      column: 5,
    },
  },
  score: 0.885,
  x: 64,
  y: 32,
  tileSize: 64,
}

function makeRect(left: number, top: number, width: number, height: number) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect
}

function pointerEvent(type: string, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

function dragEvent(type: string, dataTransfer: DataTransfer) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return event
}

function buttonWithText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.toLowerCase().includes(text.toLowerCase()),
  )
}

describe('guided screenshot-to-source demo', () => {
  let container: HTMLDivElement
  let root: Root
  const scrollIntoView = vi.fn()

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    const canvasContext = {
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: vi.fn(),
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(720 * 300 * 4) }),
      save: vi.fn(),
      restore: vi.fn(),
      strokeRect: vi.fn(),
      strokeStyle: '',
      lineWidth: 1,
    }

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => canvasContext as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,capture',
    )
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 1294,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 710,
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        if (this.classList.contains('sprint-card')) {
          return makeRect(351, 490, 726, 298)
        }
        if (
          this.classList.contains('sample-app-host') ||
          this.classList.contains('selection-layer')
        ) {
          return makeRect(73, 195, 1294, 710)
        }
        return makeRect(0, 0, 100, 40)
      },
    )

    const rendered = document.createElement('canvas')
    rendered.width = 1294
    rendered.height = 710
    mocks.toCanvas.mockResolvedValue(rendered)
    mocks.analyzeScreenshot.mockReturnValue([MATCH])

    await act(async () => root.render(<App />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('closes the loop from drawn crop to source and back to the interface', async () => {
    const selectionLayer = container.querySelector<HTMLElement>('.selection-layer')
    expect(selectionLayer).not.toBeNull()

    await act(async () => {
      selectionLayer?.dispatchEvent(pointerEvent('pointerdown', 420, 680))
    })
    await act(async () => {
      selectionLayer?.dispatchEvent(pointerEvent('pointermove', 1120, 980))
    })
    await act(async () => {
      selectionLayer?.dispatchEvent(pointerEvent('pointerup', 1120, 980))
      await Promise.resolve()
    })

    const capture = buttonWithText(container, 'Drag this crop into analysis')
    const dropPanel = container.querySelector<HTMLElement>('.drop-panel')
    expect(capture?.draggable).toBe(true)
    expect(dropPanel?.dataset.ready).toBe('true')
    expect(dropPanel?.textContent).toContain('Drop it here to analyse')

    const transferValues = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      files: [] as unknown as FileList,
      setData: (type: string, value: string) => {
        transferValues.set(type, value)
      },
      getData: (type: string) => transferValues.get(type) ?? '',
    } as unknown as DataTransfer

    await act(async () => {
      capture?.dispatchEvent(dragEvent('dragstart', dataTransfer))
      dropPanel?.dispatchEvent(dragEvent('drop', dataTransfer))
      await new Promise((resolve) => window.setTimeout(resolve, 100))
    })

    expect(
      container.querySelector('.path-breadcrumb')?.getAttribute('data-path'),
    ).toBe('MORROW_DASHBOARD/sprint-overview')
    expect(container.textContent).toContain('SprintOverview.tsx:41:5')
    expect(
      container.querySelector('.source-code-line[data-highlighted="true"]')
        ?.textContent,
    ).toContain('id="sprint-overview"')

    const hideCode = buttonWithText(container, 'Hide code')
    await act(async () => hideCode?.click())
    expect(container.querySelector('.source-code-panel')).toBeNull()

    const viewCode = buttonWithText(container, 'View code')
    await act(async () => viewCode?.click())
    expect(container.querySelector('.source-code-panel')).not.toBeNull()

    const showInterface = buttonWithText(container, 'Show in interface')
    scrollIntoView.mockClear()
    await act(async () => {
      showInterface?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 90))
    })

    expect(selectionLayer?.dataset.sourceFocus).toBe('true')
    expect(container.querySelector('.selection-rect')?.textContent).toContain(
      'SprintOverview.tsx:41:5',
    )
    expect(container.querySelector('.sprint-card')?.classList).toContain(
      'source-focused',
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(
      container.querySelector('.sprint-card'),
    )

    const fileInput = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File(['not an image'], 'notes.txt', { type: 'text/plain' })],
    })
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(selectionLayer?.dataset.sourceFocus).toBe('false')
    expect(container.querySelector('.selection-rect')).toBeNull()
    expect(container.querySelector('.source-focused')).toBeNull()
    expect(container.textContent).toContain('Choose a PNG, JPEG, or WebP screenshot.')
  })
})
