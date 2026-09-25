// Sanity: does the same registry/codebook decode a known-good carrier PNG?
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const root = process.cwd()
const { PNG } = createRequire(root + '/package.json')('pngjs')
const { decodePng } = await import(pathToFileURL(`${root}/decoder/decode.ts`))
const { generatePatternRgba, createPatternPayload } = await import(pathToFileURL(`${root}/src/pattern.ts`))

const TARGET = { path: 'shop/card', type: 'card', depth: 2,
  source: { file: 'src/Card.tsx', line: 12, column: 5 } }
const tile = generatePatternRgba(createPatternPayload(TARGET), 64, 0.08)
const png = new PNG({ width: 128, height: 160 })
for (let y = 0; y < 160; y++) {
  for (let x = 0; x < 128; x++) {
    const s = ((y % 64) * 64 + (x % 64)) * 4
    const d = (y * 128 + x) * 4
    const a = tile[s + 3] / 255
    for (let c = 0; c < 3; c++) png.data[d + c] = Math.round(255 * (1 - a) + tile[s + c] * a)
    png.data[d + 3] = 255
  }
}
const path = '/tmp/sanity.png'
writeFileSync(path, PNG.sync.write(png))
console.log('wrote', path)

const r1 = decodePng(readFileSync(path), [TARGET], { intensity: 0.08, scales: [1] })
console.log('scale=1:', JSON.stringify(r1, null, 2))
const r2 = decodePng(readFileSync(path), [TARGET], { intensity: 0.08 })
console.log('auto:', JSON.stringify(r2, null, 2))