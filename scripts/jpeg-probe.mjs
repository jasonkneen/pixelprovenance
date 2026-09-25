// JPEG robustness probe for the v2 carrier.
// Renders a v2 carrier on a flat background, JPEG-encodes at q75/q90 via
// ImageMagick, converts back to PNG so the actual decoder can read it,
// then measures correlation via decodePng.

import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'

const root = process.cwd()
const outDir = '/tmp/pp-jpeg'
mkdirSync(outDir, { recursive: true })

const { decodePng } = await import(pathToFileURL(`${root}/decoder/decode.ts`))
const { generatePatternRgba, createPatternPayload } = await import(
  pathToFileURL(`${root}/src/pattern.ts`)
)

const TARGET = { path: 'JPEG/card', type: 'card', depth: 2 }

function render(scale = 1) {
  const tileSize = 64
  const width = 128 * scale
  const height = 160 * scale
  const tile = generatePatternRgba(createPatternPayload(TARGET), tileSize, 0.08)
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tileX = ((Math.floor(x / scale) % tileSize) + tileSize) % tileSize
      const tileY = ((Math.floor(y / scale) % tileSize) + tileSize) % tileSize
      const source = (tileY * tileSize + tileX) * 4
      const destination = (y * width + x) * 4
      const alpha = tile[source + 3] / 255
      for (let c = 0; c < 3; c += 1) {
        png.data[destination + c] = Math.round(224 * (1 - alpha) + tile[source + c] * alpha)
      }
      png.data[destination + 3] = 255
    }
  }
  return png
}

function runMagick(args) {
  return execSync(`magick ${args}`, { cwd: outDir, encoding: 'utf8' })
}

function jpegRoundTrip(name, quality) {
  const basePng = render(SCALE)
  const basePath = `${outDir}/${name}-base.png`
  writeFileSync(basePath, PNG.sync.write(basePng))
  runMagick(`${name}-base.png -quality ${quality} ${name}-q${quality}.jpg`)
  runMagick(`${name}-q${quality}.jpg -quality 100 ${name}-q${quality}.png`)
  const recovered = readFileSync(`${outDir}/${name}-q${quality}.png`)
  return { basePng, recovered }
}

const SCALE = parseInt(process.env.SCALE ?? '1', 10)
const qualities = (process.env.QUALITIES ?? '60,70,75,80,85,90,95').split(',').map(Number)
const results = []
for (const quality of qualities) {
  const { basePng, recovered } = jpegRoundTrip(`s${SCALE}`, quality)
  const decoded = decodePng(recovered, [TARGET], {
    intensity: 0.08,
    patternSize: 64,
    scales: [SCALE],
  })
  const decodedAuto = decodePng(recovered, [TARGET], {
    intensity: 0.08,
    patternSize: 64,
  })
  results.push({
    scale: SCALE,
    quality,
    file: `${SCALE === 1 ? '128x160' : '256x320'} PNG -> JPEG q${quality} -> PNG`,
    matchDirect: decoded[0] ?? null,
    matchAutoScale: decodedAuto[0] ?? null,
  })
}

console.log(JSON.stringify(results, null, 2))
writeFileSync(`${outDir}/s${SCALE}-results.json`, JSON.stringify(results, null, 2))