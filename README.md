# PixelProvenance

Component identification for React screenshots. Zero configuration.

## Install

```bash
npm install pixelprovenance
```

## Usage

Add one line to your app:

```tsx
import 'pixelprovenance/auto'

// That's it - everything auto-tagged
```

## Decode Screenshots

```bash
node decode-screenshot.js screenshot.png
```

Output:
```
=== Found 3 components ===

✓ App/Header            (component, 25.5%)
  src/App.tsx:6-18

✓ App/ActionsPanel      (panel, 21.9%)
  src/App.tsx:50-66
```

## How It Works

1. Auto-detects components via React internals
2. Renders invisible identification markers
3. Decoder extracts component paths from screenshots
4. Shows exact source file + line numbers

## Dev Only

Markers only render in development mode (`NODE_ENV === 'development'`). Zero production impact.

## Manual Mode

For more control:

```tsx
import { DevTag, DevTagRoot } from 'pixelprovenance'

function App() {
  return (
    <DevTagRoot pageId="DASHBOARD">
      <DevTag id="header" type="panel">
        <Header />
      </DevTag>
    </DevTagRoot>
  )
}
```

## License
This work is licensed under a Creative Commons Attribution-NonCommercial
4.0 International License (CC BY-NC 4.0).
