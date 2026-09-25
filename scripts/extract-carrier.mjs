// Extract the carrier tile from the round-trip captured PNG and decode.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const root = process.cwd()
const { PNG } = createRequire(root + '/package.json')('pngjs')
const { decodePng } = await import(pathToFileURL(`${root}/decoder/decode.ts`))

const dpr = parseInt(process.argv[2] ?? '1', 10)
const png = PNG.sync.read(readFileSync(`/tmp/pp-roundtrip-dpr${dpr}.png`))

// Crop the .card region from the body capture.
const cardX = 24 * dpr, cardY = 24 * dpr
const cardW = 370 * dpr, cardH = 322 * dpr
const cropped = new PNG({ width: cardW, height: cardH })
for (let y = 0; y < cardH; y++) {
  for (let x = 0; x < cardW; x++) {
    const s = ((y + cardY) * png.width + (x + cardX)) * 4
    const d = (y * cardW + x) * 4
    for (let c = 0; c < 4; c++) cropped.data[d + c] = png.data[s + c]
  }
}
const croppedPath = `/tmp/pp-card-crop-dpr${dpr}.png`
writeFileSync(croppedPath, PNG.sync.write(cropped))
console.log('wrote', croppedPath, 'size:', cropped.width, 'x', cropped.height)

const TARGET = { path: 'shop/card', type: 'card', depth: 2,
  source: { file: 'src/Card.tsx', line: 12, column: 5 } }

for (const scales of [[1], [2], [1,2], [dpr]]) {
  const r = decodePng(readFileSync(croppedPath), [TARGET], { intensity: 0.08, scales })
  console.log('scales=' + JSON.stringify(scales) + ':', r[0] ?? 'NO MATCH')
}