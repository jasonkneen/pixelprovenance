# Drop-in selector toolbar

Date: 2026-09-07

## Goal

A vanilla script people can add to a site. It renders its own toolbar. Select (click) is the default gesture; crop is the second button. A selection becomes a JSON package plus PNG, delivered to a model channel (window event first, POST endpoint second). MCP/SSE consume that same object later.

## Install

```html
<script
  src="pixelprovenance-dropin.js"
  data-pp-page="pricing"
  data-pp-endpoint="http://127.0.0.1:8787/package"
></script>

<section data-pp="hero">…</section>
<button data-pp="cta" data-pp-source="src/Pricing.tsx:88:9">Start</button>
```

Default `enabled` is on for localhost / 127.0.0.1 / [::1], or when `data-pp-enabled="true"`. Off otherwise. React `DevTag` / CLI stay unchanged.

## Package

```ts
{
  version: 1,
  pageId: string,
  path: string,
  type: string,
  depth: number,
  selector: string,
  rect: { x: number, y: number, w: number, h: number },
  source?: { file: string, line: number, column: number },
  html: string,
  image: string,
  score?: number,
  capturedAt: string
}
```

Picker fills this from the DOM. Crop fills it by decoding the live codebook (`[data-pp]` and existing DevTag paths). The model does not run the frequency decoder.

Delivery order:

1. `pixelprovenance:package` CustomEvent on `window` (`detail` is the package)
2. `POST data-pp-endpoint` with `Content-Type: application/json`
3. `window.PixelProvenance.onPackage(cb)`

## Toolbar

Self-rendered. Host CSS not required. Marked `data-pp-toolbar` so it cannot be picked.

- Select: hover outline, click element
- Crop: drag rectangle (min 32×32, snap on release)
- Esc / Cancel: abort

Click target: deepest `[data-pp]`, else `[data-testid]`, else `[id]`, else the element. Path is `pageId` plus ancestor `data-pp` segments plus the target segment. `data-pp-source` is `file:line:column`.

## Signals

On mount, paint the existing chroma tile onto `[data-pp]` nodes (same generator as `DevTag`). Do not wrap markup. Do not double-paint nodes that already have a DevTag signal child.

## Out of scope

npm publish, MCP server, SSE worker, auto-tagging every `div`, production-on-by-default.

Agent install: `llms.txt`, `docs/llms.txt`, `skills/pixelprovenance/SKILL.md`.
