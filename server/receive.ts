#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Reference receiver for drop-in selection packages.
 *
 * POST /package   — store a package (JSON + PNG) and print a one-line summary
 * GET  /latest    — most recent package without the image (for agents/curl)
 * GET  /health    — liveness
 *
 * Handles the CORS preflight a JSON POST triggers from any localhost page,
 * and Chrome's Private Network Access header.
 */

const MAX_BODY_BYTES = 25 * 1024 * 1024

export interface ReceiverOptions {
  port?: number
  host?: string
  outDir?: string
  onPackage?: (record: StoredPackage) => void
  log?: (line: string) => void
}

export interface StoredPackage {
  file: string
  image?: string
  pkg: Record<string, unknown>
}

function cors(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader('access-control-allow-origin', request.headers.origin ?? '*')
  response.setHeader('vary', 'origin')
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type')
  response.setHeader('access-control-allow-private-network', 'true')
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Package exceeds 25 MB'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80) || 'package'
}

function isPackage(value: unknown): value is Record<string, unknown> & { path: string; image?: unknown } {
  return typeof value === 'object' && value !== null &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { path?: unknown }).path === 'string'
}

export function createReceiver(options: ReceiverOptions = {}): Server {
  const outDir = resolve(options.outDir ?? '.pixelprovenance/inbox')
  const log = options.log ?? ((line: string) => console.log(line))
  let latest: Record<string, unknown> | null = null

  return createServer(async (request, response) => {
    cors(request, response)
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      send(response, 200, { ok: true })
      return
    }
    if (request.method === 'GET' && url.pathname === '/latest') {
      send(response, latest ? 200 : 404, latest ?? { error: 'No package yet' })
      return
    }
    if (request.method !== 'POST' || url.pathname !== '/package') {
      send(response, 404, { error: 'Not found' })
      return
    }
    try {
      const parsed: unknown = JSON.parse(await readBody(request))
      if (!isPackage(parsed)) {
        send(response, 400, { error: 'Expected a version 1 selection package' })
        return
      }
      mkdirSync(outDir, { recursive: true })
      const stem = `${new Date().toISOString().replace(/[:.]/g, '-')}-${slug(parsed.path)}`
      const { image, ...rest } = parsed
      const record: StoredPackage = { file: join(outDir, `${stem}.json`), pkg: rest }
      const match = typeof image === 'string' ? image.match(/^data:image\/png;base64,(.+)$/) : null
      if (match) {
        record.image = join(outDir, `${stem}.png`)
        writeFileSync(record.image, Buffer.from(match[1], 'base64'))
      }
      const stored = { ...rest, ...(record.image ? { imageFile: record.image } : {}) }
      writeFileSync(record.file, `${JSON.stringify(stored, null, 2)}\n`)
      writeFileSync(join(outDir, 'latest.json'), `${JSON.stringify(stored, null, 2)}\n`)
      latest = stored
      const source = rest.source as { file?: string; line?: number } | undefined
      log(`${parsed.path}${source?.file ? `  ${source.file}:${source.line}` : ''}  → ${record.file}`)
      options.onPackage?.(record)
      send(response, 200, { ok: true, file: record.file, image: record.image })
    } catch (error) {
      send(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  })
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

const USAGE = 'Usage: pixelprovenance-receive [--port 8787] [--host 127.0.0.1] [--out .pixelprovenance/inbox]'

function runCli(args: string[]): void {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return
  }
  const port = Number(readFlag(args, '--port') ?? 8787)
  const host = readFlag(args, '--host') ?? '127.0.0.1'
  const outDir = readFlag(args, '--out')
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(USAGE)
  const server = createReceiver({ outDir })
  server.listen(port, host, () => {
    console.log(`pixelprovenance receiver on http://${host}:${port}/package`)
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli(process.argv.slice(2))
}
