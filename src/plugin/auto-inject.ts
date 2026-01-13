/**
 * Runtime Auto-Injection
 *
 * Patches React.createElement to automatically wrap components with DevTag.
 * Zero manual wrapping needed - just include this script.
 */

import * as React from 'react'

let isPatched = false
let componentRegistry: Array<{ path: string; type: string; depth: number }> = []

// Track component hierarchy
const pathStack: string[] = []

/**
 * Patch React.createElement to auto-wrap with DevTag
 */
export function enableAutoDevTag(intensity: number = 0.15) {
  if (isPatched) return
  if (process.env.NODE_ENV !== 'development') return

  const originalCreateElement = React.createElement

  // @ts-ignore - monkey patch React
  React.createElement = function (type: any, props: any, ...children: any[]) {
    // Only wrap function components and class components
    const isComponent =
      typeof type === 'function' ||
      (typeof type === 'object' && type?.$$typeof)

    if (!isComponent) {
      return originalCreateElement(type, props, ...children)
    }

    // Get component name
    const componentName = type.displayName || type.name || 'Anonymous'
    const componentType = inferType(componentName, type)

    // Build path
    const currentPath = [...pathStack, componentName]
    const pathString = currentPath.join('/')

    // Add to registry
    if (!componentRegistry.some(c => c.path === pathString)) {
      componentRegistry.push({
        path: pathString,
        type: componentType,
        depth: currentPath.length,
      })
    }

    // Push onto stack
    pathStack.push(componentName)

    // Create wrapped element
    const wrappedProps = {
      ...props,
      'data-devtag-path': pathString,
      'data-devtag-type': componentType,
    }

    try {
      // Render original
      const element = originalCreateElement(type, wrappedProps, ...children)

      // Pop stack
      pathStack.pop()

      // Wrap with DevTag (lazy import to avoid circular deps)
      const { DevTagPerceptual } = require('../DevTagPerceptual')

      return originalCreateElement(
        DevTagPerceptual,
        {
          id: componentName,
          type: componentType,
          intensity,
        },
        element
      )
    } catch (err) {
      pathStack.pop()
      // Fallback to original if wrapping fails
      return originalCreateElement(type, props, ...children)
    }
  }

  isPatched = true
  console.log('[DevTag] Auto-instrumentation enabled')
}

/**
 * Infer component type from name
 */
function inferType(name: string, _component: any): string {
  const lowerName = name.toLowerCase()

  if (lowerName.includes('button') || lowerName.includes('btn')) return 'button'
  if (lowerName.includes('modal') || lowerName.includes('dialog')) return 'modal'
  if (lowerName.includes('panel') || lowerName.includes('card')) return 'panel'
  if (lowerName.includes('page') || lowerName.includes('view')) return 'page'
  if (lowerName.includes('header') || lowerName.includes('nav')) return 'nav'
  if (lowerName.includes('footer')) return 'footer'
  if (lowerName.includes('sidebar')) return 'sidebar'
  if (lowerName.includes('form')) return 'form'
  if (lowerName.includes('input') || lowerName.includes('field')) return 'input'
  if (lowerName.includes('list') || lowerName.includes('grid')) return 'list'

  return 'component'
}

/**
 * Get the component registry for decoder
 */
export function getComponentRegistry() {
  return componentRegistry
}

/**
 * Export registry as JSON for the decoder
 */
export function exportRegistry(): string {
  return JSON.stringify(componentRegistry, null, 2)
}
