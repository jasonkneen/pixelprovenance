import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const root = process.cwd()
const require = createRequire(root + '/package.json')
const { PNG } = require('pngjs')
const { decodePng } = await import(pathToFileURL(root + '/decoder/decode.ts'))
const { generatePatternRgba, createPatternPayload } = await import(pathToFileURL(root + '/src/pattern.ts'))
const target = { path: 'BENCH/card', type: 'card', depth: 2 }
const tile = generatePatternRgba(createPatternPayload(target), 64, 0.08)
const images = [1, 2].flatMap(scale => [0, 7, 19].map(shift => {
  const png = new PNG({ width: 128 * scale, height: 160 * scale })
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const source = ((Math.floor((y + 11) / scale) % 64) * 64 + Math.floor((x + shift) / scale) % 64) * 4
    const destination = (y * png.width + x) * 4
    for (let c = 0; c < 3; c++) png.data[destination + c] = Math.round(224 * (1 - 3/255) + tile[source + c] * 3/255)
    png.data[destination + 3] = 255
  }
  return PNG.sync.write(png)
}))
const scan = () => images.map(image => decodePng(image, [target]))
scan()
const start = performance.now()
const results = scan()
const elapsedMs = performance.now() - start
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ elapsedMs, results }, null, 2))
console.log(JSON.stringify({ elapsedMs, matches: results.map(r => r[0]?.path ?? null) }))
