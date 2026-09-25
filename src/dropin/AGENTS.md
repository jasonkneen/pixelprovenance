# AGENTS.md — src/dropin/

Vanilla drop-in: toolbar, picker, crop, signals, package transport.

- Read /AGENTS.md and /docs/llms.txt first.
- No React imports in this folder.
- Selection package `version` is the literal `1`. Event name is `pixelprovenance:package`.
- Toolbar and highlight layers use `data-pp-toolbar` so they cannot be picked.
- IIFE build: `npm run build:dropin` (also part of `build:lib`).
