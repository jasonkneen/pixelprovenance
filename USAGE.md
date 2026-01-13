# Morrow DevTag - Usage Guide

## Installation (Local Development)

```bash
# In your project
npm install /path/to/morrow-devtag
```

Or add to package.json:
```json
{
  "dependencies": {
    "morrow-devtag": "file:../morrow-devtag"
  }
}
```

## Quick Start

### 1. Wrap Components

```tsx
import { DevTagPerceptualRoot, DevTagPerceptual } from 'morrow-devtag'

function App() {
  return (
    <DevTagPerceptualRoot pageId="DASHBOARD">
      <div>
        <DevTagPerceptual id="header" type="panel">
          <Header />
        </DevTagPerceptual>

        <DevTagPerceptual id="sidebar" type="panel">
          <Sidebar>
            <DevTagPerceptual id="nav-home" type="button">
              <NavButton>Home</NavButton>
            </DevTagPerceptual>
          </Sidebar>
        </DevTagPerceptual>
      </div>
    </DevTagPerceptualRoot>
  )
}
```

### 2. Run Your App

```bash
NODE_ENV=development npm run dev
```

The patterns only render in development mode.

### 3. Screenshot → Decode

Take a screenshot, then decode:

```bash
node decode-screenshot.js screenshot.png
```

Output:
```
=== Found 4 components ===

✓ DASHBOARD                           (page, 28.0%, high)
✓ DASHBOARD/header                    (panel, 24.3%, high)
✓ DASHBOARD/sidebar                   (panel, 21.7%, medium)
✓ DASHBOARD/sidebar/nav-home          (button, 18.2%, low)
```

## Decoder Setup

Create `decode-screenshot.js` in your project:

```javascript
import { readFileSync } from 'fs'
import { PNG } from 'pngjs'
import {
  buildPerceptualRegistry,
  scanImagePerceptual
} from 'morrow-devtag/decoder'

const imagePath = process.argv[2]
const pngData = readFileSync(imagePath)

// Define YOUR app's component tree
const components = [
  { path: 'DASHBOARD', type: 'page', depth: 1 },
  { path: 'DASHBOARD/header', type: 'panel', depth: 2 },
  { path: 'DASHBOARD/sidebar', type: 'panel', depth: 2 },
  { path: 'DASHBOARD/sidebar/nav-home', type: 'button', depth: 3 },
]

const registry = buildPerceptualRegistry(components, 64, 0.15)
const results = scanImagePerceptual(pngData, registry, 64, 0.15)

for (const r of results) {
  console.log(`✓ ${r.path} (${r.type}, ${(r.score * 100).toFixed(1)}%)`)
}
```

## Component Props

### DevTagPerceptualRoot

```tsx
<DevTagPerceptualRoot
  pageId="PAGE_NAME"
  intensity={0.15}  // 0.05-0.2 (higher = more visible)
>
  {children}
</DevTagPerceptualRoot>
```

### DevTagPerceptual

```tsx
<DevTagPerceptual
  id="component-id"
  type="panel|button|modal|etc"
  intensity={0.15}
  patternSize={64}
  disabled={false}
>
  {children}
</DevTagPerceptual>
```

## How It Works

1. **Encoding**: Each component generates a unique sine wave pattern based on its path hash
2. **Hierarchical**: Paths build automatically (DASHBOARD/panel/button)
3. **Invisible**: Subtle noise (±4% gray variation) looks like paper grain
4. **Resilient**: Survives Retina 2x scaling via perceptual correlation matching

## Claude Integration

Give a screenshot to Claude with this instruction:

```
Here's a screenshot with a bug. Use morrow-devtag decoder to identify which component it is.

Run: node decode-screenshot.js screenshot.png
```

Claude will decode and tell you:
```
Bug in: DASHBOARD/actions-panel/submit-btn (button)
```

## Intensity Guidelines

| Value | Visibility | Use Case |
|-------|-----------|----------|
| 0.05 | Nearly invisible | Production-like demo |
| 0.10 | Subtle texture | Standard dev mode |
| 0.15 | Visible grain | Reliable Retina scanning |
| 0.20 | Obvious pattern | Debugging decoder |

## Production

The components automatically return null when `NODE_ENV !== 'development'`. Zero production impact.
