# PixelProvenance

PixelProvenance is an experimental React tool for tracing screenshot regions back to code. It embeds each tagged region’s path and source location into a faint, luminance-balanced chroma pattern in the pixels, then recovers that mapping by correlating a crop against a codebook of known embeddings.

The repository includes an interactive web demo, the React package, a decoder CLI, and a small test suite covering deterministic generation and 1x/2x decoding.

The package is not currently available from the public npm registry. Use the local checkout until a release is published.

## Run the web demo

```bash
npm install
npm run dev
```

The demo presents a normal project dashboard and walks through the complete interaction: draw a rectangle over one card, drag the resulting crop into the analyser, recover its component and source mapping, inspect the highlighted TSX line, then jump back to the originating interface element. A second pass demonstrates the same recovery from a deliberately smaller crop. The analysis runs locally in the browser. The hero also links to a downloadable PDF of the archived research paper.

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
--threshold 0.7
--pattern-size 64
--intensity 0.12
--scale auto|1|2
```

## Package API

- `DevTag` and `DevTagRoot` render hierarchical signal regions.
- `generatePattern` and `generatePatternRgba` expose the deterministic pattern engine.
- `buildRegistry`, `scanPixels`, `scanPng`, and `decodePng` are exported from `pixelprovenance/decode`.

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
