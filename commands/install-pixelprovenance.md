---
description: Install PixelProvenance drop-in toolbar into the current app
argument-hint: "[pageId] [endpoint-url]"
---

Install PixelProvenance into this application.

Follow the skill at `${CLAUDE_PLUGIN_ROOT}/skills/pixelprovenance/SKILL.md` (or `skills/pixelprovenance/SKILL.md` in this repo). Read `docs/llms.txt` for the package contract.

Arguments:

- `$1` is the `pageId` slug. If missing, derive a short slug from the app name (dashboard, marketing, app).
- `$2` is an optional POST endpoint. If missing, do not set `endpoint`; listen for `pixelprovenance:package`.

Default path: drop-in toolbar + `data-pp` on a few stable regions. Do not wrap the tree in `DevTag` unless the user asked.

Verify on localhost: toolbar visible, Select then click a tagged node, package `version` is 1 and `path` starts with the pageId.
