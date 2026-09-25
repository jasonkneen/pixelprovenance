/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSelectionPackage } from './package.js'
import { deliverPackage } from './transport.js'
import type { SelectionPackage } from './types.js'

const SAMPLE: SelectionPackage = {
  version: 1,
  pageId: 'pricing',
  path: 'pricing/cta',
  type: 'button',
  depth: 2,
  selector: '[data-pp="cta"]',
  rect: { x: 10, y: 20, w: 160, h: 44 },
  html: '<button data-pp="cta">Start</button>',
  image: 'data:image/png;base64,QQ==',
  capturedAt: '2026-09-07T00:00:00.000Z',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createSelectionPackage', () => {
  it('stamps version 1 and truncates long html', () => {
    const html = `<div>${'x'.repeat(5000)}</div>`
    const pkg = createSelectionPackage({
      pageId: 'pricing',
      path: 'pricing/hero',
      type: 'panel',
      depth: 2,
      selector: '[data-pp="hero"]',
      rect: { x: 0, y: 0, w: 32, h: 32 },
      html,
      image: 'data:image/png;base64,QQ==',
    })
    expect(pkg.version).toBe(1)
    expect(pkg.html.length).toBeLessThanOrEqual(4000)
    expect(pkg.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('deliverPackage', () => {
  it('dispatches a window event and POSTs to the endpoint', async () => {
    const seen: SelectionPackage[] = []
    window.addEventListener('pixelprovenance:package', (event) => {
      if (event instanceof CustomEvent) seen.push(event.detail)
    })
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const result = await deliverPackage(SAMPLE, {
      endpoint: 'http://127.0.0.1:8787/package',
      fetch: fetchImpl,
    })
    expect(seen).toEqual([SAMPLE])
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8787/package', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAMPLE),
    })
    expect(result).toEqual({ ok: true })
  })

  it('reports a failed POST without throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
    const result = await deliverPackage(SAMPLE, {
      endpoint: 'http://127.0.0.1:8787/package',
      fetch: fetchImpl,
    })
    expect(result).toEqual({ ok: false, error: 'offline' })
  })

  it('notifies onPackage subscribers', async () => {
    const listener = vi.fn()
    const unsubscribe = deliverPackage.subscribe(listener)
    await deliverPackage(SAMPLE, {})
    expect(listener).toHaveBeenCalledWith(SAMPLE)
    unsubscribe()
    await deliverPackage(SAMPLE, {})
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
