import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const repositoryRoot = new URL('..', import.meta.url)
const temporaryRoot = mkdtempSync(join(tmpdir(), 'pixelprovenance-package-'))
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(command, args, cwd, expectedStatus = 0) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
  })

  if (result.status !== expectedStatus) {
    throw new Error(
      [
        `Command failed (${result.status}): ${command} ${args.join(' ')}`,
        result.stdout,
        result.stderr,
      ].filter(Boolean).join('\n'),
    )
  }

  return result
}

run(npmCommand, ['run', 'build:lib'], repositoryRoot)

const packed = run(
  npmCommand,
  ['pack', '--ignore-scripts', '--json', '--pack-destination', temporaryRoot],
  repositoryRoot,
)
const archive = JSON.parse(packed.stdout)[0]?.filename
if (!archive) throw new Error('npm pack did not report an archive filename')
const archivePath = join(temporaryRoot, archive)

const consumerProgram = String.raw`
  import { writeFileSync } from 'node:fs'
  import { PNG } from 'pngjs'
  import { createElement } from 'react'
  import {
    DevTag,
    createPatternPayload,
    generatePatternRgba,
  } from 'pixelprovenance'
  import { decodePng } from 'pixelprovenance/decode'
  import { renderToStaticMarkup } from 'react-dom/server'

  if (typeof DevTag !== 'function' || typeof decodePng !== 'function') {
    throw new Error('Public package exports are missing')
  }

  const markerMarkup = renderToStaticMarkup(
    createElement(
      DevTag,
      { id: 'consumer', enabled: true },
      createElement('span', null, 'Consumer'),
    ),
  )
  const disabledMarkup = renderToStaticMarkup(
    createElement(
      DevTag,
      { id: 'consumer', enabled: false },
      createElement('span', null, 'Consumer'),
    ),
  )
  if (!markerMarkup.includes('data-pixelprovenance-path="consumer"')) {
    throw new Error('DevTag did not render with this React peer')
  }
  if (disabledMarkup !== '<span>Consumer</span>') {
    throw new Error('Disabled DevTag changed consumer markup')
  }

  const component = {
    path: 'LAB_DASHBOARD/inspection-panel',
    type: 'panel',
    depth: 2,
    source: {
      file: 'src/features/lab/InspectionPanel.tsx',
      line: 22,
      column: 5,
    },
  }
  const size = 64
  const png = new PNG({ width: size, height: size })
  png.data.set(
    generatePatternRgba(createPatternPayload(component), size, 0.16),
  )
  writeFileSync('sample.png', PNG.sync.write(png))
  writeFileSync('registry.json', JSON.stringify([component]))
  writeFileSync('invalid-registry.json', JSON.stringify({ bad: true }))

  const flat = new PNG({ width: size, height: size })
  flat.data.fill(255)
  writeFileSync('flat.png', PNG.sync.write(flat))
`

const typeConsumerProgram = String.raw`
  import { DevTag, type ComponentDescriptor } from 'pixelprovenance'
  import { decodePng, type DecodeOptions } from 'pixelprovenance/decode'

  const component: ComponentDescriptor = {
    path: 'consumer',
    type: 'component',
    depth: 1,
  }
  const options: DecodeOptions = { scales: [1] }
  void DevTag
  void decodePng(new Uint8Array(), [component], options)
`

for (const reactVersion of ['18.0.0', '18', '19.0.0', '19']) {
  const consumerRoot = join(temporaryRoot, `react-${reactVersion}`)
  mkdirSync(consumerRoot)
  run(npmCommand, ['init', '--yes'], consumerRoot)
  run(
    npmCommand,
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      archivePath,
      `react@${reactVersion}`,
      `react-dom@${reactVersion}`,
      `@types/react@${reactVersion.startsWith('18') ? '18' : '19'}`,
      `@types/react-dom@${reactVersion.startsWith('18') ? '18' : '19'}`,
      'typescript@7.0.2',
    ],
    consumerRoot,
  )
  writeFileSync(join(consumerRoot, 'consumer.mts'), typeConsumerProgram)
  writeFileSync(
    join(consumerRoot, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        lib: ['ES2022', 'DOM'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        strict: true,
      },
      files: ['consumer.mts'],
    }),
  )
  run(
    process.platform === 'win32'
      ? join(consumerRoot, 'node_modules', '.bin', 'tsc.cmd')
      : join(consumerRoot, 'node_modules', '.bin', 'tsc'),
    ['--project', 'tsconfig.json'],
    consumerRoot,
  )
  run(
    process.execPath,
    ['--input-type=module', '--eval', consumerProgram],
    consumerRoot,
  )

  const binary = join(
    consumerRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'pixelprovenance-decode.cmd' : 'pixelprovenance-decode',
  )
  const decoded = run(
    binary,
    [
      'sample.png',
      '--registry',
      'registry.json',
      '--intensity',
      '0.16',
      '--threshold',
      '0.95',
      '--scale',
      '1',
    ],
    consumerRoot,
  )
  if (!decoded.stdout.includes('LAB_DASHBOARD/inspection-panel')) {
    throw new Error('Installed CLI did not decode the expected component')
  }
  if (!decoded.stdout.includes('src/features/lab/InspectionPanel.tsx:22:5')) {
    throw new Error('Installed CLI did not print the expected source mapping')
  }

  const invalid = run(
    binary,
    ['sample.png', '--registry', 'invalid-registry.json'],
    consumerRoot,
    1,
  )
  if (!invalid.stderr.includes('components array')) {
    throw new Error('Installed CLI did not reject a malformed registry')
  }

  const noMatch = run(
    binary,
    ['flat.png', '--registry', 'registry.json'],
    consumerRoot,
    1,
  )
  if (!noMatch.stdout.includes('No matching')) {
    throw new Error('Installed CLI did not report the no-match case')
  }
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
rmSync(temporaryRoot, { recursive: true, force: true })
console.log(
  `Verified pixelprovenance@${manifest.version} package exports and CLI with React 18 and 19`,
)
