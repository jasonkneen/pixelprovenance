// Re-probe the original JPEG capture question with the new v3 (luma) carrier.
// Generates a v3 carrier at intensity 0.08 on grey, JPEG-encodes at q60-95,
// converts back to PNG, and runs the CLI. v2 is included for comparison.

import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = '/Users/jkneen/Documents/GitHub/pixelprovenance'
const outDir = '/tmp/pp-jpeg-v3'
mkdirSync(outDir, { recursive: true })

const { PNG } = createRequire(root + '/package.json')('pngjs')
const { decodePng } = await import(pathToFileURL(`${root}/decoder/decode.ts`))
const { generatePatternRgba, createPatternPayload } = await import(pathToFileURL(`${root}/src/pattern.ts`))

const TARGET_V2 = { path: 'A/card', type: 'card', depth: 2, patternVersion: 2,
  source: { file: 'a.ts', line: 1, column: 1 } }
const TARGET_V3 = { path: 'A/card', type: 'card', depth: 2, patternVersion: 3,
  source: { file: 'a.ts', line: 1, column: 1 } }

function render(version) {
  const target = version === 2 ? TARGET_V2 : TARGET_V3
  const tile = generatePatternRgba(createPatternPayload(target), 64, 0.08, version)
  const png = new PNG({ width: 128, height: 160 })
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 128; x++) {
      const s = ((y % 64) * 64 + (x % 64)) * 4
      const d = (y * 128 + x) * 4
      const a = tile[s + 3] / 255
      for (let c = 0; c < 3; c++) png.data[d + c] = Math.round(224 * (1 - a) + tile[s + c] * a)
      png.data[d + 3] = 255
    }
  }
  return png
}

function jpegRoundTrip(name, quality) {
  const basePath = `${outDir}/${name}-base.png`
  execSync(`magick ${basePath} -quality ${quality} ${name}-q${quality}.jpg`, { cwd: outDir })
  execSync(`magick ${name}-q${quality}.jpg -quality 100 ${name}-q${quality}.png`, { cwd: outDir })
  return readFileSync(`${outDir}/${name}-q${quality}.png`)
}

function decode(png, version) {
  const target = version === 2 ? TARGET_V2 : TARGET_V3
  return decodePng(png, [target], { intensity: 0.08, scales: [1] })
}

const results = []
for (const version of [2, 3]) {
  const png = render(version)
  writeFileSync(`${outDir}/v${version}-base.png`, PNG.sync.write(png))
  const baselineScore = decode(PNG.sync.write(png), version)[0]?.score?.toFixed(3) ?? 'NO MATCH'
  results.push({ version, quality: 'baseline', file: 'PNG (no JPEG)', score: baselineScore })
  for (const q of [60, 70, 75, 80, 85, 90, 95]) {
    const recovered = jpegRoundTrip(`v${version}`, q)
    const decoded = decode(recovered, version)
    results.push({ version, quality: q, file: `PNG → JPEG q${q} → PNG`, score: decoded[0]?.score?.toFixed(3) ?? 'NO MATCH' })
  }
}

console.log(JSON.stringify(results, null, 2))
writeFileSync(`${outDir}/results.json`, JSON.stringify(results, null, 2))