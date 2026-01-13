/**
 * PixelProvenance - Auto Mode
 *
 * Usage: import 'pixelprovenance/auto'
 *
 * That's it. Everything gets tagged automatically via side effects.
 */

// Re-export overlay for manual use
export { ComponentMapper } from './ComponentMapper'

// Auto-initialize if in dev mode
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  // Inject overlay automatically after DOM loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDevTag)
  } else {
    initializeDevTag()
  }
}

async function initializeDevTag() {
  // Load source map if available
  try {
    const response = await fetch('/.devtag-sources.json')
    if (response.ok) {
      const sources = await response.json()
      ;(window as any).__DEVTAG_SOURCES__ = sources
      console.log('[DevTag] Loaded source map:', sources.length, 'components')
    }
  } catch {
    // Source map not available - OK, will work without line numbers
  }

  // Create root element for overlay
  const overlayRoot = document.createElement('div')
  overlayRoot.id = '__devtag-overlay-root__'
  document.body.appendChild(overlayRoot)

  // Dynamically import React and render overlay
  import('react').then((React) => {
    import('react-dom/client').then(({ createRoot }) => {
      import('./ComponentMapper').then(({ ComponentMapper }) => {
        const intensity = (window as any).__DEVTAG_INTENSITY__ || 0.15
        createRoot(overlayRoot).render(
          React.createElement(ComponentMapper, { intensity })
        )
        console.log('[DevTag] Auto-tagging enabled')
      })
    })
  })
}
