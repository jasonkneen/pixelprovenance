/**
 * PixelProvenance - Zero Config Vite Plugin
 *
 * Usage:
 *   import { devTag } from 'pixelprovenance/plugin'
 *
 *   export default defineConfig({
 *     plugins: [react(), devTag()]
 *   })
 *
 * That's it. Everything auto-tags.
 */

import type { Plugin } from 'vite'

interface DevTagPluginOptions {
  intensity?: number
}

export function devTag(options: DevTagPluginOptions = {}): Plugin {
  const { intensity = 0.15 } = options

  let isDev = false

  return {
    name: 'vite-plugin-devtag',

    configResolved(config) {
      isDev = config.mode === 'development'
    },

    transformIndexHtml(html) {
      if (!isDev) return html

      // Inject auto-enable script BEFORE any other scripts
      return html.replace(
        '<head>',
        `<head>
  <script type="module">
    // DevTag auto-initialization
    window.__DEVTAG_ENABLED__ = true;
    window.__DEVTAG_INTENSITY__ = ${intensity};
  </script>`
      )
    },

    transform(code, id) {
      if (!isDev) return null

      // Find the root render call and inject DevTagOverlay
      if (id.match(/\/(main|index|App)\.(tsx|jsx)$/)) {
        // Check if it has createRoot or render
        if (code.includes('createRoot') || code.includes('render(')) {
          // Inject import and component
          const injection = `
import { DevTagOverlay as __DevTagOverlay__ } from 'pixelprovenance/auto';
import { Fragment as __Fragment__ } from 'react';
`
          // Wrap the rendered content
          const wrappedCode = code
            .replace(
              /createRoot\(([^)]+)\)\.render\(([^)]+)\)/g,
              (_match, root, content) => {
                // Wrap content with Fragment containing overlay
                return `createRoot(${root}).render(__Fragment__, {}, ${content}, __DevTagOverlay__({ intensity: window.__DEVTAG_INTENSITY__ || ${intensity} }))`
              }
            )
            .replace(
              /render\(\s*</g,
              'render(<__Fragment__><__DevTagOverlay__ intensity={window.__DEVTAG_INTENSITY__ || ' +
                intensity +
                '} /><'
            )

          if (wrappedCode !== code) {
            return {
              code: injection + wrappedCode,
              map: null,
            }
          }
        }
      }

      return null
    },
  }
}

export { sourceMapPlugin } from './source-map-plugin'
export default devTag
