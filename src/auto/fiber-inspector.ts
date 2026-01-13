/**
 * React Fiber Tree Inspector
 *
 * Walks the React fiber tree at runtime and injects DevTag data attributes.
 * Zero manual wrapping - automatically tags all components.
 */

interface FiberNode {
  type: any
  stateNode: any
  child: FiberNode | null
  sibling: FiberNode | null
  return: FiberNode | null
  memoizedProps: any
  elementType: any
}

/**
 * Find React root fiber from a DOM element
 */
function findReactRoot(element: Element): FiberNode | null {
  const keys = Object.keys(element)
  const fiberKey = keys.find(key =>
    key.startsWith('__reactFiber') ||
    key.startsWith('__reactInternalInstance') ||
    key.startsWith('__reactContainer')
  )

  if (!fiberKey) return null

  // @ts-ignore
  let fiber = element[fiberKey] as FiberNode

  // If it's a container, navigate to the actual fiber root
  if (fiberKey.startsWith('__reactContainer')) {
    // Container has a _internalRoot.current structure in React 18+
    fiber = (fiber as any)?._internalRoot?.current || (fiber as any)?.current
  }

  return fiber
}

/**
 * Get component name from fiber
 */
function getComponentName(fiber: FiberNode): string | null {
  if (!fiber.type) return null

  if (typeof fiber.type === 'string') {
    return fiber.type // div, span, etc.
  }

  if (typeof fiber.type === 'function') {
    return fiber.type.displayName || fiber.type.name || null
  }

  if (fiber.type?.displayName || fiber.type?.name) {
    return fiber.type.displayName || fiber.type.name
  }

  return null
}

/**
 * Walk fiber tree and inject data attributes
 */
function walkFiberTree(
  fiber: FiberNode | null,
  path: string[] = [],
  callback: (fiber: FiberNode, path: string[]) => void
) {
  if (!fiber) return

  const name = getComponentName(fiber)

  if (name && fiber.stateNode instanceof Element) {
    const currentPath = [...path, name]
    callback(fiber, currentPath)

    // Inject data attributes on the DOM element
    fiber.stateNode.setAttribute('data-devtag-path', currentPath.join('/'))
    fiber.stateNode.setAttribute('data-devtag-component', name)

    // Recurse with updated path
    if (fiber.child) {
      walkFiberTree(fiber.child, currentPath, callback)
    }
  } else {
    // Not a named component, continue with same path
    if (fiber.child) {
      walkFiberTree(fiber.child, path, callback)
    }
  }

  // Process siblings
  if (fiber.sibling) {
    walkFiberTree(fiber.sibling, path, callback)
  }
}

/**
 * Start auto-tagging
 */
export function enableAutoDevTag() {
  if (process.env.NODE_ENV !== 'development') return

  // Find React root
  const root = document.getElementById('root')
  if (!root) {
    console.warn('[DevTag] No #root element found')
    return
  }

  // Set up observer to tag components as they mount
  const observer = new MutationObserver(() => {
    const fiber = findReactRoot(root)
    if (fiber) {
      const registry: Array<{ path: string; depth: number }> = []

      walkFiberTree(fiber, [], (_f, path) => {
        registry.push({ path: path.join('/'), depth: path.length })
      })

      // Export registry to window for decoder access
      ;(window as any).__DEVTAG_REGISTRY__ = registry
    }
  })

  observer.observe(root, {
    childList: true,
    subtree: true,
  })

  // Initial scan
  setTimeout(() => {
    const fiber = findReactRoot(root)
    if (fiber) {
      const registry: Array<{ path: string; depth: number }> = []
      walkFiberTree(fiber, [], (_f, path) => {
        registry.push({ path: path.join('/'), depth: path.length })
      })
      ;(window as any).__DEVTAG_REGISTRY__ = registry

      console.log(
        `[DevTag] Tagged ${registry.length} components`,
        registry.map(r => r.path)
      )
    }
  }, 100)
}

// Auto-enable if flag is set
if (typeof window !== 'undefined' && (window as any).__DEVTAG_AUTO_ENABLE__) {
  enableAutoDevTag()
}
