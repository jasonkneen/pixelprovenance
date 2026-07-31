# PixelProvenance usage guide

## Installation

The package is not yet published. Build and pack a checkout before installing
it into another project:

```bash
cd /absolute/path/to/pixelprovenance
npm install
npm run check
npm pack

cd /path/to/consumer
npm install /absolute/path/to/pixelprovenance/pixelprovenance-0.2.0.tgz
```

Or install the published package when available:

```bash
npm install pixelprovenance
```

React 18 and React 19 are supported peer ranges. Node 20.19 or newer is required.

## Component props

### `DevTagRoot`

| Prop | Type | Default | Purpose |
| --- | --- | --- | --- |
| `pageId` | `string` | required | Root path segment |
| `enabled` | `boolean` | development detection | Explicit marker switch |
| `intensity` | `number` | `0.06` | Pattern signal strength, clamped to 0-1 |
| `patternSize` | `number` | `64` | CSS tile size, clamped to 16-256 |
| `debug` | `boolean` | `false` | Reveals the tagged region border |
| `signal` | `boolean` | `true` | Suppresses this boundary's own pattern while retaining its path context |
| `className` | `string` | — | Wrapper class |
| `style` | `CSSProperties` | — | Wrapper styles |

### `DevTag`

`DevTag` accepts the same rendering controls plus:

| Prop | Type | Default | Purpose |
| --- | --- | --- | --- |
| `id` | `string` | required | Stable path segment |
| `type` | `string` | `component` | Category included in the pattern seed |
| `source` | `{ file, line, column }` | — | Code location **embedded in the noise** |
| `children` | `ReactNode` | required | Tagged region |

Use IDs that remain stable across builds. Avoid list indexes, generated UUIDs, or user data.

When `source` is set, it is part of the pattern seed together with path, type, and depth. Encode and decode must use the same values or correlation fails.

## Intensity guidance

| Value | Expected appearance | Suggested use |
| --- | --- | --- |
| `0.05-0.08` | Intended to be visually imperceptible | Starting range for normal development |
| `0.10-0.16` | Faint under inspection | Decoder calibration |
| `0.20-0.30` | Stronger machine signal | Stress testing; likely too visible for normal UI review |

The effective screenshot signal is also affected by the tagged region's colors and texture.

## Decoder registry

The CLI accepts either an array of descriptors or an object with a `components` array. Every descriptor must contain `path`, `type`, and numeric `depth` values.

Tag a **hierarchy**: parent panels and nested leaves (chips, nav items, rows). Each tag embeds its own `source` into the noise; the registry/codebook lists the same embeddings for correlation. On decode, the deepest confident match wins, so a crop of a chip resolves to the chip’s line, not only the parent card.

```json
{
  "components": [
    {
      "path": "SETTINGS/profile",
      "type": "panel",
      "depth": 2,
      "source": {
        "file": "src/features/settings/ProfilePanel.tsx",
        "line": 31,
        "column": 5
      }
    },
    {
      "path": "SETTINGS/profile/save",
      "type": "button",
      "depth": 3,
      "patternSize": 32,
      "source": {
        "file": "src/features/settings/ProfilePanel.tsx",
        "line": 48,
        "column": 9
      }
    }
  ]
}
```

Optional `patternSize` is the 1× tile size used when that region was encoded (default 64). Use 16–32 for small leaves so a tight crop can cover a full tile.

The registry settings must match the component settings used for capture. If you change root `patternSize` or `intensity`, pass those values to the decoder.

## Programmatic decoding

```ts
import { readFile } from 'node:fs/promises'
import { decodePng } from 'pixelprovenance/decode'

const components = [
  {
    path: 'SETTINGS/profile',
    type: 'panel',
    depth: 2,
    source: {
      file: 'src/features/settings/ProfilePanel.tsx',
      line: 31,
      column: 5,
    },
  },
]

const results = decodePng(await readFile('screenshot.png'), components, {
  intensity: 0.12,
  patternSize: 64,
  scales: [1, 2],
})

for (const result of results) {
  console.log(result.path, result.source, result.score)
}
```

## Production control

Prefer an explicit bundler flag:

```tsx
<DevTagRoot pageId="SETTINGS" enabled={import.meta.env.DEV}>
  <SettingsPage />
</DevTagRoot>
```

When disabled, signal attributes and overlays are omitted. A layout wrapper is
kept only when `className` or `style` was provided; otherwise only the children
render. The retained wrapper keeps the same default `position: relative` style
as an enabled tag.
