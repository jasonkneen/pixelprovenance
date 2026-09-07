/** @vitest-environment jsdom */

import { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DevTag } from './DevTag.js'

afterEach(() => vi.restoreAllMocks())

it('never displays the previous carrier after its source mapping changes', async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  let serial = 0
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() =>
    `data:image/png;base64,${btoa(`pattern-${++serial}`)}`,
  )
  const committedBackgrounds: string[] = []
  function Probe() {
    useLayoutEffect(() => {
      const signal = host.querySelector<HTMLElement>('[data-pixelprovenance-signal]')
      committedBackgrounds.push(signal?.style.backgroundImage ?? '')
    })
    return <span>Child</span>
  }
  function render(line: number) {
    return <DevTag id="client-update-test" enabled source={{ file: 'src/Card.tsx', line, column: 1 }}>
      <Probe />
    </DevTag>
  }
  try {
    await act(async () => root.render(render(10)))
    const previous = host.querySelector<HTMLElement>('[data-pixelprovenance-signal]')!.style.backgroundImage
    expect(previous).not.toBe('')
    committedBackgrounds.length = 0
    await act(async () => root.render(render(20)))
    expect(committedBackgrounds).not.toContain(previous)
    const current = host.querySelector<HTMLElement>('[data-pixelprovenance-signal]')!.style.backgroundImage
    expect(current).not.toBe(previous)
    expect(current).not.toBe('')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
