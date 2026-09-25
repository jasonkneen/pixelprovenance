import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createReceiver } from './receive.js'

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
let cleanup: Array<() => void> = []

afterEach(() => {
  for (const step of cleanup) step()
  cleanup = []
})

async function start() {
  const outDir = mkdtempSync(join(tmpdir(), 'pp-receive-'))
  const lines: string[] = []
  const server = createReceiver({ outDir, log: (line) => lines.push(line) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => {
    server.close()
    rmSync(outDir, { recursive: true, force: true })
  })
  const { port } = server.address() as AddressInfo
  return { base: `http://127.0.0.1:${port}`, outDir, lines }
}

describe('receiver', () => {
  it('answers the CORS and private-network preflight', async () => {
    const { base } = await start()
    const response = await fetch(`${base}/package`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(response.headers.get('access-control-allow-headers')).toContain('content-type')
    expect(response.headers.get('access-control-allow-private-network')).toBe('true')
  })

  it('stores a package as JSON plus PNG and serves the latest', async () => {
    const { base, lines } = await start()
    const pkg = {
      version: 1,
      pageId: 'pricing',
      path: 'pricing/cta',
      source: { file: 'src/Pricing.tsx', line: 88, column: 9 },
      image: `data:image/png;base64,${PNG_1PX}`,
    }
    const response = await fetch(`${base}/package`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pkg),
    })
    const body = await response.json() as { file: string; image: string }
    expect(response.status).toBe(200)
    expect(readFileSync(body.image).subarray(1, 4).toString()).toBe('PNG')
    const stored = JSON.parse(readFileSync(body.file, 'utf8'))
    expect(stored.image).toBeUndefined()
    expect(stored.imageFile).toBe(body.image)
    expect(lines[0]).toContain('src/Pricing.tsx:88')
    const latest = await (await fetch(`${base}/latest`)).json() as { path: string }
    expect(latest.path).toBe('pricing/cta')
  })

  it('rejects bodies that are not selection packages', async () => {
    const { base } = await start()
    const response = await fetch(`${base}/package`, { method: 'POST', body: '{"hello":1}' })
    expect(response.status).toBe(400)
  })
})
