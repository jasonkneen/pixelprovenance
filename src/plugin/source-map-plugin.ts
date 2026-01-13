/**
 * Source Map Plugin - Extract component locations at build time
 *
 * Parses .tsx files to build a registry mapping component names to
 * file paths and line numbers.
 */

import type { Plugin } from 'vite'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { writeFileSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Handle both ESM and CJS imports
const traverse = (traverseModule as any).default || traverseModule

interface ComponentLocation {
  name: string
  file: string
  startLine: number
  endLine: number
}

function scanDirectory(dir: string, root: string): ComponentLocation[] {
  const locations: ComponentLocation[] = []
  let filesScanned = 0

  function walk(currentDir: string) {
    const entries = readdirSync(currentDir)
    console.log(`[DevTag] Scanning ${currentDir}, found ${entries.length} entries`)

    for (const entry of entries) {
      const fullPath = join(currentDir, entry)
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'dist' && entry !== '.git') {
          walk(fullPath)
        }
      } else if (entry.endsWith('.tsx') || entry.endsWith('.jsx')) {
        // Parse file
        filesScanned++
        console.log(`[DevTag] Parsing ${entry}...`)
        try {
          const code = readFileSync(fullPath, 'utf-8')
          const ast = parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript'],
          })

          let componentsInFile = 0

          traverse(ast, {
            FunctionDeclaration(path: any) {
              const name = path.node.id?.name
              if (name && isPascalCase(name)) {
                componentsInFile++
                locations.push({
                  name,
                  file: fullPath.replace(root, '').replace(/^\//, ''),
                  startLine: path.node.loc?.start.line || 0,
                  endLine: path.node.loc?.end.line || 0,
                })
              }
            },

            VariableDeclarator(path: any) {
              if (
                path.node.id.type === 'Identifier' &&
                isPascalCase(path.node.id.name) &&
                (path.node.init?.type === 'ArrowFunctionExpression' ||
                  path.node.init?.type === 'FunctionExpression')
              ) {
                componentsInFile++
                locations.push({
                  name: path.node.id.name,
                  file: fullPath.replace(root, '').replace(/^\//, ''),
                  startLine: path.node.loc?.start.line || 0,
                  endLine: path.node.init.loc?.end.line || 0,
                })
              }
            },
          })

          console.log(`[DevTag] Found ${componentsInFile} components in ${entry}`)
        } catch (err) {
          console.error(`[DevTag] Parse error in ${entry}:`, err instanceof Error ? err.message : err)
        }
      }
    }
  }

  walk(dir)
  return locations
}

export function sourceMapPlugin(): Plugin {
  let root = ''

  return {
    name: 'vite-plugin-devtag-sourcemap',

    configResolved(config) {
      root = config.root
    },

    // No transform needed - we scan files at buildEnd

    buildEnd() {
      // Scan src directory for all components
      const srcDir = join(root, 'src')

      console.log(`[DevTag] Scanning ${srcDir} for components...`)

      try {
        const locations = scanDirectory(srcDir, root)

        // Write component location registry
        const registryPath = join(root, '.devtag-sources.json')
        writeFileSync(registryPath, JSON.stringify(locations, null, 2))
        console.log(`[DevTag] Wrote ${locations.length} component locations to .devtag-sources.json`)
      } catch (err) {
        console.error('[DevTag] Error scanning:', err)
      }
    },
  }
}

function isPascalCase(name: string): boolean {
  return /^[A-Z]/.test(name)
}

export type { ComponentLocation }
