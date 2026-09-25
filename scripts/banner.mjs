// Prepend the licence header to the IIFE bundles (minification strips comments).
import { readFileSync, writeFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const banner = `/*! PixelProvenance ${pkg.version} | License: ${pkg.license} | ${pkg.homepage}\n *  Separate work from any tool that loads it (e.g. cluso-inspector, MIT). */\n`
for (const name of process.argv.slice(2)) {
  const file = new URL(`../dist/${name}`, import.meta.url)
  const code = readFileSync(file, 'utf8')
  if (!code.startsWith('/*! PixelProvenance')) writeFileSync(file, banner + code)
}
