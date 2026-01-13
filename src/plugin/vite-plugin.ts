/**
 * Vite Plugin - Auto-instrument React components with DevTag
 *
 * Zero config: just add the plugin and it auto-tags everything
 */

import type { Plugin } from 'vite'
import { transformSync } from '@babel/core'

interface DevTagPluginOptions {
  intensity?: number
  enabled?: boolean | 'auto' // 'auto' = only in dev
}

/**
 * Babel visitor that wraps JSX elements with DevTag
 */
function createDevTagTransform(intensity: number = 0.15) {
  return {
    visitor: {
      JSXElement(path: any, state: any) {
        const { types: t } = state

        // Skip if already wrapped with DevTag
        const openingElement = path.node.openingElement
        if (openingElement.name.name?.includes('DevTag')) {
          return
        }

        // Get component name/type
        let componentId = 'unknown'
        let componentType = 'component'

        // Try to extract ID from parent function/class name
        const functionParent = path.findParent((p: any) =>
          p.isFunctionDeclaration() ||
          p.isArrowFunctionExpression() ||
          p.isFunctionExpression() ||
          p.isClassDeclaration()
        )

        if (functionParent) {
          if (functionParent.node.id?.name) {
            componentId = functionParent.node.id.name
          } else {
            // Anonymous component - use JSX element name
            const elementName = openingElement.name.name
            if (elementName) {
              componentId = elementName
              componentType = ['div', 'span', 'button', 'a'].includes(elementName)
                ? elementName
                : 'component'
            }
          }
        }

        // Build wrapper
        const wrappedElement = t.jsxElement(
          t.jsxOpeningElement(
            t.jsxIdentifier('DevTagPerceptual'),
            [
              t.jsxAttribute(
                t.jsxIdentifier('id'),
                t.stringLiteral(componentId)
              ),
              t.jsxAttribute(
                t.jsxIdentifier('type'),
                t.stringLiteral(componentType)
              ),
              t.jsxAttribute(
                t.jsxIdentifier('intensity'),
                t.jsxExpressionContainer(t.numericLiteral(intensity))
              ),
            ],
            false
          ),
          t.jsxClosingElement(t.jsxIdentifier('DevTagPerceptual')),
          [path.node],
          false
        )

        path.replaceWith(wrappedElement)
      },
    },
  }
}

export function devTagPlugin(options: DevTagPluginOptions = {}): Plugin {
  const {
    intensity = 0.15,
    enabled = 'auto',
  } = options

  return {
    name: 'vite-plugin-devtag',

    configResolved(config) {
      // Auto-enable in dev mode
      if (enabled === 'auto' && config.mode !== 'development') {
        return
      }
    },

    transform(code, id) {
      // Only transform .tsx/.jsx files
      if (!id.endsWith('.tsx') && !id.endsWith('.jsx')) {
        return null
      }

      // Skip node_modules
      if (id.includes('node_modules')) {
        return null
      }

      // Check if enabled
      const isEnabled =
        enabled === true || (enabled === 'auto' && process.env.NODE_ENV === 'development')

      if (!isEnabled) {
        return null
      }

      try {
        // Add import at top of file if not present
        const hasImport = code.includes('DevTagPerceptual')
        const importStatement = hasImport
          ? ''
          : `import { DevTag } from 'pixelprovenance';\n`

        // Transform with Babel
        const result = transformSync(code, {
          filename: id,
          plugins: [
            '@babel/plugin-syntax-jsx',
            '@babel/plugin-syntax-typescript',
            createDevTagTransform(intensity),
          ],
          parserOpts: {
            plugins: ['jsx', 'typescript'],
          },
        })

        if (result?.code) {
          return {
            code: importStatement + result.code,
            map: result.map,
          }
        }
      } catch (err) {
        // Fail silently - don't break builds
        console.warn('[devtag] Transform failed for', id, err)
      }

      return null
    },
  }
}
