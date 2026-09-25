/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { mount, unmount } from './mount.js'
import type { SelectionPackage } from './types.js'

function mockRect(element: HTMLElement, rect: { x: number; y: number; w: number; h: number }) {
  element.getBoundingClientRect = () => ({
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.w,
    bottom: rect.y + rect.h,
    toJSON() {
      return this
    },
  })
}

afterEach(() => {
  unmount()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('mount', () => {
  it('does not render a toolbar when disabled', () => {
    mount({ pageId: 'pricing', enabled: false })
    expect(document.querySelector('[data-pp-toolbar]')).toBeNull()
  })

  it('renders Select and Crop controls', () => {
    mount({ pageId: 'pricing', enabled: true })
    const toolbar = document.querySelector('[data-pp-toolbar]')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.textContent).toContain('Select')
    expect(toolbar?.textContent).toContain('Crop')
  })

  it('packages a clicked data-pp element and delivers it', async () => {
    const cta = document.createElement('button')
    cta.setAttribute('data-pp', 'cta')
    cta.setAttribute('data-pp-source', 'src/Pricing.tsx:88:9')
    cta.textContent = 'Start'
    document.body.append(cta)
    mockRect(cta, { x: 80, y: 420, w: 160, h: 44 })

    const captureElement = vi.fn().mockResolvedValue('data:image/png;base64,QQ==')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const packages: SelectionPackage[] = []
    window.addEventListener('pixelprovenance:package', (event) => {
      if (event instanceof CustomEvent) packages.push(event.detail)
    })

    mount({
      pageId: 'pricing',
      enabled: true,
      endpoint: 'http://127.0.0.1:8787/package',
      captureElement,
      fetch: fetchImpl,
    })

    document.querySelector<HTMLButtonElement>('[data-pp-action="select"]')?.click()
    cta.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await vi.waitFor(() => expect(packages).toHaveLength(1))
    expect(packages[0]?.path).toBe('pricing/cta')
    expect(packages[0]?.source).toEqual({
      file: 'src/Pricing.tsx',
      line: 88,
      column: 9,
    })
    expect(packages[0]?.image).toBe('data:image/png;base64,QQ==')
    expect(captureElement).toHaveBeenCalledWith(cta)
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('does not treat toolbar clicks as a selection', async () => {
    const captureElement = vi.fn()
    mount({ pageId: 'pricing', enabled: true, captureElement })
    document.querySelector<HTMLButtonElement>('[data-pp-action="select"]')?.click()
    document.querySelector('[data-pp-toolbar]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await Promise.resolve()
    expect(captureElement).not.toHaveBeenCalled()
  })
})
