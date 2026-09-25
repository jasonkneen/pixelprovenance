# PixelProvenance usage guide

## Installation

The package is not yet published to the public npm registry. Install from git,
or pack a checkout:

```bash
npm install github:jasonkneen/pixelprovenance
```

```bash
cd /absolute/path/to/pixelprovenance
npm install
npm run check
npm pack

cd /path/to/consumer
npm install /absolute/path/to/pixelprovenance/pixelprovenance-0.2.0.tgz
```

When a registry release exists:

```bash
npm install pixelprovenance
```

React 18 and React 19 are supported peer ranges. Node 20.19 or newer is required.

## Drop-in toolbar

For a site that is not wrapping every region in React tags, load the IIFE and mark the nodes you care about:

```html
<script
  src="./node_modules/pixelprovenance/dist/pixelprovenance-dropin.js"
  data-pp-page="pricing"
  data-pp-endpoint="http://127.0.0.1:8787/package"
></script>
```

Or mount from a bundler:

```ts
import { mount } from 'pixelprovenance/dropin'

mount({
  pageId: 'pricing',
  endpoint: 'http://127.0.0.1:8787/package',
  enabled: true,
})
```

Select (click) packages the deepest `[data-pp]`, else `[data-testid]`, else `[id]`. Crop names the tag it covers from layout (`method: "dom"`), with overlapping `candidates`; `verifyPixels` adds an in-page pixel cross-check. Both dispatch `pixelprovenance:package` and POST to `endpoint` when set.

The toolbar stays off on public hosts unless `data-pp-enabled="true"` or `enabled: true`.

### Script attributes

| Attribute | Purpose | Default |
| --- | --- | --- |
| `data-pp-page` | Root path segment | `page` |
| `data-pp-endpoint` | POST URL for the selection package | none |
| `data-pp-enabled` | `true` / `false` | on for localhost only |
| `data-pp-intensity` | Carrier opacity; alpha = round(intensity × 50)/255 | `0.06` |
| `data-pp-pattern-size` | Default CSS tile 16–256 | `64` |
| `data-pp-debug` | Show region borders | `false` |
| `data-pp-verify-pixels` | Also decode crop pixels in-page | `false` |

### Region attributes

| Attribute | Purpose |
| --- | --- |
| `data-pp` | Stable path segment |
| `data-pp-type` | Category (default: tag name) |
| `data-pp-source` | `file:line:column` embedded in the pattern |
| `data-pp-key` | Stable key for repeated items (`row[<key>]`); otherwise `row[0]`, `row[1]`… |
| `data-pp-pattern-size` | Override the automatic tile (page default, or 32 on small elements) |

### Selection package

Dispatched as `pixelprovenance:package` (`event.detail`). Posted to `endpoint` when set. HTML truncated to 4000 characters. Crop packages add `method` (`dom` / `pixels` / `none`), `candidates`, and with `verifyPixels` a `pixel` agreement object; `score` is set only when pixels named the path.

Run `npx pixelprovenance-receive` for a local endpoint that stores each package as JSON + PNG and serves `GET /latest`.

With cluso-inspector, load `pixelprovenance-cluso.js` instead of the drop-in; see `docs/llms.txt`.

See `docs/llms.txt` for the full object.

Agents installing this into another app should follow `skills/pixelprovenance/SKILL.md`.

## Component props

### `DevTagRoot`

| Prop | Type | Default | Purpose |
| --- | --- | --- | --- |
| `pageId` | `string` | required | Root path segment |
| `enabled` | `boolean` | development detection | Explicit marker switch |
| `intensity` | `number` | `0.06` | Carrier opacity (alpha = round(intensity × 50)/255), clamped to 0-1 |
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

Optional `patternSize` is the 1× tile size used when that region was encoded (default 64). Use 32 for small leaves so a tight crop can cover a full tile; 16px tiles do not survive resampling. Optional `patternVersion` (1 or 2, default 2) selects the carrier generation; screenshots made before v2 need `1`.

The registry must repeat the path, type, depth, source and tile size used for capture. Intensity only sets on-screen opacity, so the decoder does not need it for v2 carriers.

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
