# AGENTS.md

Read `llms.txt` and `docs/llms.txt` before installing this into another app or changing the drop-in/package API.

This repository is the PixelProvenance library, demo, decoder CLI, and agent plugin. The product people add to a website is the drop-in toolbar (`pixelprovenance-dropin.js` / `pixelprovenance/dropin`), not the demo page.

## Commands

- Package manager: npm
- Test: `npm test`
- Typecheck: `npm run typecheck`
- Build library + IIFE: `npm run build:lib`
- Full check (typecheck, tests, demo build, packed-consumer verify): `npm run check`
- Dev demo: `npm run dev`
- Lint: none configured

Run typecheck and tests before claiming a change works. After drop-in or public-export edits, also run `npm run build:lib`. After packaging edits, run `npm run verify:package`.

## Layout

- `src/dropin/` — vanilla toolbar, picker, crop, transport (no React)
- `src/DevTag.tsx` — React tags
- `src/pattern.ts` — shared frequency generator (byte-compatible)
- `src/demo.tsx` — marketing/demo only
- `decoder/` — PNG CLI
- `skills/pixelprovenance/` — install skill for host apps
- `commands/` — Claude slash commands
- `examples/dropin.html` — drop-in smoke page

## Rules

- Keep encode/decode seeds aligned: path, type, depth, and `source` when present.
- Do not restore `pixelprovenance/auto` or a bundler plugin that guesses every component.
- Do not enable the overlay in production by default.
- Do not publish to npm unless the user asked.
- License is CC BY-NC 4.0.
- Demo analysis lives in `src/demo-analysis.ts`; the drop-in crop path reuses it. Changes there affect both.

## Installing into a host app

Follow `skills/pixelprovenance/SKILL.md`. The contract is `docs/llms.txt`. Default path is drop-in + `data-pp`, not wrapping the tree in `DevTag`.

## Sub-context

Read the closest `AGENTS.md` before editing that folder.

- `src/AGENTS.md`
- `src/dropin/AGENTS.md`
- `decoder/AGENTS.md`
- `skills/AGENTS.md`
