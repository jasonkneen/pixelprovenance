# Host recipes

Contract: `docs/llms.txt`.

## Static HTML

Copy `node_modules/pixelprovenance/dist/pixelprovenance-dropin.js` to `public/pixelprovenance-dropin.js` (or the host static folder).

```html
<script
  src="/pixelprovenance-dropin.js"
  data-pp-page="pricing"
  data-pp-enabled="true"
></script>
```

`data-pp-enabled="true"` is for opening the file from disk or a non-loopback preview. Prefer omitting it on real localhost.

## Vite / React SPA

Client entry, once, next to the app root:

```tsx
import { mount } from 'pixelprovenance/dropin'

if (import.meta.env.DEV) {
  mount({ pageId: 'app', enabled: true })
}
```

Or serve the IIFE from `public/` and add the script tag in `index.html` only when `import.meta.env.DEV` is inlined by a small Vite plugin. The `mount()` call is simpler.

## Next.js App Router

```tsx
'use client'

import { useEffect } from 'react'
import { mount, unmount } from 'pixelprovenance/dropin'

export function PixelProvenanceMount() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    mount({ pageId: 'app', enabled: true })
    return () => unmount()
  }, [])
  return null
}
```

Render `<PixelProvenanceMount />` from a client child of the root layout. Do not import `pixelprovenance/dropin` in a Server Component.

## Listening without an endpoint

```ts
window.addEventListener('pixelprovenance:package', (event) => {
  if (!(event instanceof CustomEvent)) return
  console.info(event.detail.path, event.detail.source)
})
```

## POST to a local worker

```ts
mount({
  pageId: 'app',
  enabled: true,
  endpoint: 'http://127.0.0.1:8787/package',
})
```

The worker must accept POST JSON and CORS from the app origin if they differ. The drop-in does not retry failed POSTs; the toolbar status shows the error.

## Public path for the IIFE

`pixelprovenance/pixelprovenance-dropin.js` is an export of the package. Bundlers that copy package files can use:

```
node_modules/pixelprovenance/dist/pixelprovenance-dropin.js
```
