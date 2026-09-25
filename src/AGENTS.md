# AGENTS.md — src/

Library entry, React tags, demo, and pattern engine.

- Read /AGENTS.md and /docs/llms.txt first.
- `index.ts` is the React/package public API. Drop-in is `dropin/`.
- `demo.tsx` is not part of the npm public API.
- Pattern payloads (`createPatternPayload`) must stay byte-compatible. Carrier generations are versioned (`PATTERN_VERSION`); never change an existing version's output — add a new one and keep the old decodable.
- `spectral.ts` is the shared v2 decoder used by `demo-analysis.ts` and `decoder/decode.ts`.
