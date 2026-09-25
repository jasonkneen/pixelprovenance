---
name: pixelprovenance
description: Install PixelProvenance into a website so a selector toolbar can package a UI region for a model. Use when the user asks to add PixelProvenance, a screenshot-to-component picker, data-pp tags, DevTag, a visual select toolbar, or to send a clicked UI region over HTTP/MCP/SSE.
---

# Install PixelProvenance

Install the drop-in toolbar into the host app. Do not wrap the React tree in `DevTag` unless the user asked for that.

Read `docs/llms.txt` (this repository) or `node_modules/pixelprovenance/llms.txt` after install for the contract. Host recipes: `references/host-recipes.md`.

## Goal

On localhost, the host shows a Select / Crop / Cancel toolbar. Select + click a marked region dispatches `pixelprovenance:package` with path, selector, optional source, html, and a PNG data URL. If `endpoint` is set, POST that JSON.

## Procedure

### 1. Inspect the host

Read `package.json`, the app root (Vite `main.tsx` / Next `app/layout.tsx` / `index.html`), and how the host gates dev-only UI.

Choose the encode path:

- Default: drop-in + `data-pp` on existing markup.
- React wrappers: `DevTag` / `DevTagRoot` only if the user wants component wrappers.
- Combining is allowed: DevTag for encode, drop-in for the toolbar. Drop-in skips nodes that already have a signal child.
- Host already runs cluso-inspector: do not add a second toolbar. Load `dist/pixelprovenance-cluso.js` (before or after `cluso-inspector.js`) with `data-pp-page`, or `ClusoInspector.use(pixelprovenancePlugin(), { pageId })` from `pixelprovenance/cluso`. Comments then carry the `data-pp` path and source.

### 2. Install the package

```bash
npm view pixelprovenance version
```

If that succeeds: `npm install pixelprovenance` (or pnpm/yarn/bun equivalent).

If it 404s:

```bash
npm install github:jasonkneen/pixelprovenance
```

Confirm `node_modules/pixelprovenance/dist/pixelprovenance-dropin.js` exists. If missing, `npm rebuild pixelprovenance` or run `npm run build:lib` inside `node_modules/pixelprovenance`.

Copy this skill into the host so later sessions can maintain it:

- `.agents/skills/pixelprovenance/SKILL.md` or
- `.claude/skills/pixelprovenance/SKILL.md`

Copy `docs/llms.txt` next to it or point AGENTS.md at `node_modules/pixelprovenance/docs/llms.txt`.

### 3. Mount the drop-in

Follow `references/host-recipes.md` for Vite, Next.js, and static HTML.

Rules:

- Mount once.
- `enabled` / `data-pp-enabled` must be a dev flag, not production-on.
- `pageId` is a stable slug (`pricing`, `dashboard`), not a URL.
- `endpoint` is optional. Use it when the user named a worker URL. Otherwise listen for the window event. For a quick local receiver: `npx pixelprovenance-receive` (default `http://127.0.0.1:8787/package`).
- Repeated items (list rows, cards in a grid) get `name[0]`, `name[1]`… automatically; add `data-pp-key="<id>"` when their order can change.

### 4. Mark regions

Add `data-pp` to the regions a human would click (hero, card, primary button). Stable ids only. No list indexes, no UUIDs.

```html
<section data-pp="hero" data-pp-type="panel">…</section>
<button data-pp="cta" data-pp-type="button" data-pp-source="src/Pricing.tsx:88:9">Start</button>
```

`data-pp-source` is optional. Without it, the package still has path and selector.

Mark 3–10 regions for a first install, not the whole page.

### 5. Receive the package

```ts
window.addEventListener('pixelprovenance:package', (event) => {
  const pkg = event.detail
  // POST already happened if endpoint was set
})
```

Do not build an MCP server unless asked. The POST body is the MCP/SSE payload.

### 6. Verify

1. Run the host on localhost.
2. Confirm the toolbar (Select, Crop, Cancel).
3. Select → click a tagged node.
4. Confirm `path` is `pageId/...` and `version` is `1`.
5. If `endpoint` is set, confirm the POST.

If the toolbar is missing: hostname is not loopback and `enabled` was omitted. Set `enabled: true` in dev or `data-pp-enabled="true"`.

If click does nothing: the node is inside `[data-pp-toolbar]`, or Select was not armed first.

If capture fails: `html-to-image` cannot snapshot cross-origin assets. The event may still fire with a bad image; check the console and simplify the node.

## Do not

- Tag every element automatically.
- Enable in production by default.
- Ask the model to decode the chroma pattern.
- Change PixelProvenance source in `node_modules` to "fix" the host.

## Additional resources

- `references/host-recipes.md` — Vite, Next.js, static HTML
- `docs/llms.txt` — schema, attributes, delivery
- `USAGE.md` — DevTag props and CLI
- `examples/dropin.html` — smoke page
