# PixelProvenance

PixelProvenance tags UI regions so a screenshot or a click can be turned into a package a model can use: path, selector, optional `file:line:column`, and a PNG.

The default install is a drop-in script with its own Select / Crop toolbar. React `DevTag` and a PNG decoder CLI are optional.

Not on the public npm registry yet. Install from git:

```bash
npm install github:jasonkneen/pixelprovenance
```

Agents: read [`llms.txt`](llms.txt), then [`docs/llms.txt`](docs/llms.txt) and [`skills/pixelprovenance/SKILL.md`](skills/pixelprovenance/SKILL.md). Pasteable system prompt: [`docs/prompts/install-system.md`](docs/prompts/install-system.md).

## Add to a website

The minimum install is a script tag. It draws its own toolbar. **Select** (click an element) is the default; **Crop** draws a rectangle. Either gesture emits a JSON package plus a PNG that you can POST to a model worker, listen for on `window`, or wrap in MCP later.

```html
<script
  src="./node_modules/pixelprovenance/dist/pixelprovenance-dropin.js"
  data-pp-page="pricing"
  data-pp-endpoint="http://127.0.0.1:8787/package"
></script>

<section data-pp="hero">…</section>
<button data-pp="cta" data-pp-source="src/Pricing.tsx:88:9">Start</button>
```

The toolbar is on by default on `localhost` / `127.0.0.1`. Set `data-pp-enabled="true"` to force it on, or `"false"` to keep it off. Nested `data-pp` values become paths such as `pricing/hero/cta`.

The package is also available as `import { mount } from 'pixelprovenance/dropin'`. Listen for `pixelprovenance:package` on `window`, or `PixelProvenance.onPackage(cb)`.

### Agents and plugins

This repo is a Claude Code plugin (`.claude-plugin/plugin.json`). From a host app:

```bash
claude plugin install /absolute/path/to/pixelprovenance
# or, after cloning:
# claude --plugin-dir /absolute/path/to/pixelprovenance
```

Then `/install-pixelprovenance [pageId] [endpoint-url]`.

Grok and Codex pick up the same skill from `skills/pixelprovenance/` (this repo also has pointers under `.grok/skills` and `.agents/skills`). Copy that skill into the host's `.agents/skills/pixelprovenance/` so later sessions can maintain the install.

## Run the web demo

```bash
npm install
npm run dev
```

The demo presents a normal project dashboard and walks through the complete interaction: draw a rectangle over one card, drag the resulting crop into the analyser, recover its component and source mapping, inspect the highlighted TSX line, then jump back to the originating interface element. The “Capture sprint card” button provides an alternative to drawing, and the crop thumbnail can be clicked to analyse it without drag-and-drop. A second pass demonstrates the same recovery from a deliberately smaller crop. Selections can be as small as 32×32 pixels. The sprint title, description, task count, and individual pills have their own mappings, so a confident small crop can highlight the element within the card. The analysis runs locally in the browser. The hero also links to a downloadable PDF of the archived research paper.

## Add tags to a React app

```tsx
import { DevTag, DevTagRoot } from 'pixelprovenance'

export function Dashboard() {
  return (
    <DevTagRoot pageId="DASHBOARD" enabled={import.meta.env.DEV}>
      <main>
        <DevTag
          id="card"
          type="panel"
          source={{ file: 'src/Dashboard.tsx', line: 8, column: 9 }}
        >
          <CardHeader />
          <DevTag
            id="status"
            type="chip"
            patternSize={32}
            source={{ file: 'src/Dashboard.tsx', line: 12, column: 11 }}
          >
            <StatusPill />
          </DevTag>
        </DevTag>
      </main>
    </DevTagRoot>
  )
}
```

The `source` prop is **hashed into the noise** with path, type, and depth. Nested tags form paths such as `DASHBOARD/card/status`, each with its own embedded mapping. Use a smaller `patternSize` (16–32) on leaves so tight crops still contain a full tile. On decode, the deepest confident match wins.

Pass an explicit development flag when your bundler exposes one; production builds should not include screenshot markers.

`DevTag` renders a positioned wrapper so it can place the signal above opaque child backgrounds. Use its `className` and `style` props when the wrapper needs to participate in an existing grid or flex layout.

## Codebook (registry)

Decode correlates against a **codebook of the same embeddings** used at encode time. It is not a post-hoc path→source table — if `source` was in the tag, it must be in the codebook entry so the regenerated pattern matches the pixels:

```json
[
  {
    "path": "DASHBOARD/card",
    "type": "panel",
    "depth": 2,
    "source": { "file": "src/Dashboard.tsx", "line": 8, "column": 9 }
  },
  {
    "path": "DASHBOARD/card/status",
    "type": "chip",
    "depth": 3,
    "patternSize": 32,
    "source": { "file": "src/Dashboard.tsx", "line": 12, "column": 11 }
  }
]
```

See [`registry/demo.registry.json`](registry/demo.registry.json) for the demo codebook.

## Decode a PNG

From this repository:

```bash
npm run decode -- screenshot.png --registry registry/demo.registry.json
```

From an installed package:

```bash
pixelprovenance-decode screenshot.png --registry components.json
```

Matches print the component path and the `file:line:column` recovered from the matched embedding. The decoder checks both 1x and 2x tile sizes by default. Advanced options:

```text
--threshold 0.5          # v2 default (0.7 when the registry has v1 entries)
--pattern-size 64
--pattern-version 1|2    # 1 for screenshots made before pattern v2
--intensity 0.12
--scale auto|1|2
--step 16
--json
```

For scripts and CI, `--json` writes an array of matches to stdout, including
`path`, `type`, `depth`, optional `source`, `score`, `count`, and `tileSize`:

```bash
pixelprovenance-decode screenshot.png --registry components.json --json > matches.json
```

Exit status is 0 when a match is found and 1 for no match or an error. No match
produces `[]` in JSON mode; errors produce a diagnostic on stderr and no JSON
on stdout. `--step` controls the scan spacing in 1× pixels (scaled for each
screenshot scale). Larger values reduce grid sampling but enlarge the local
refinement search and can miss signals. Run
`pixelprovenance-decode --help` for the option list.

Pattern v2 carriers (the default) are decoded shift-invariantly: the decoder
folds each 2-tile window modulo the tile size, skipping edges and removing each
flat region's mean, then reads the carrier's twelve known frequency bins and
searches every cyclic shift in frequency space. There is no position grid to
miss, so off-grid crops, 1×/2× captures, text and coloured backgrounds decode
at full strength. `--step` applies only to legacy v1 entries, which still use
the grid search described in earlier releases. The crop still needs at least
one whole tile in each direction.

## Package API

- Drop-in: `pixelprovenance-dropin.js` or `import { mount } from 'pixelprovenance/dropin'`.
- `DevTag` and `DevTagRoot` render hierarchical signal regions.
- `generatePattern` and `generatePatternRgba` expose the deterministic pattern engine.
- `buildRegistry`, `scanPixels`, `scanPng`, and `decodePng` are exported from `pixelprovenance/decode`.

Human API tables: [`USAGE.md`](USAGE.md). Machine contract: [`docs/llms.txt`](docs/llms.txt).

## Validate the repository

```bash
npm run check
npm pack --dry-run
```

For a clean consumer install, build and install the tarball produced by
`npm pack`; see [`USAGE.md`](USAGE.md) for the exact local-package flow.

## Migrating from the original prototype

Version 0.2 removes the nonfunctional `pixelprovenance/auto` and `pixelprovenance/plugin` entry points. Replace them with explicit `DevTagRoot` and `DevTag` boundaries plus a decoder registry. The old `disabled` prop remains as a deprecated alias for `enabled={false}`, and the decoder retains deprecated `build`, `scan`, and `generatePattern` exports for source compatibility. The CLI now requires `--registry` because component paths are no longer hard-coded. The frequency derivation remains byte-compatible with the original perceptual `DevTag`, so existing screenshots can be scanned when their component descriptors and capture settings are known.

## Current limitations

- This is a research prototype, not a security watermark or authentication mechanism.
- Detection is most reliable over flat or lightly textured regions. Dense content, compression, transforms, and overlapping nested signals can reduce correlation.
- Source must be passed to `DevTag` **and** listed identically in the codebook so encode/decode seeds match. Automatic build-time injection of `source` is not part of the current package.
- Resolution is only as fine as the tag hierarchy you maintain. Untagged chips/rows fall through to the nearest ancestor’s embedded mapping.
- Only non-interlaced PNG input is supported by the CLI.
- Pattern images are generated in the browser. Keep the number and size of simultaneously mounted, uniquely tagged regions reasonable to avoid main-thread and data-URL pressure.
- Browser screenshot pipelines differ. Validate thresholds against the browsers and capture tools used by your team.

The archived paper and blog drafts describe an earlier auto-instrumentation prototype and its reported evaluation. They are retained as research artifacts and do not describe the current package API.

## License

CC BY-NC 4.0. See [`LICENSE`](LICENSE).
