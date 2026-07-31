import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { getDemoSourceSnippet, highlightTsxLine } from './demo-source.js'

describe('demo source excerpts', () => {
  it('maps the recovered sprint component to the displayed source line', () => {
    const snippet = getDemoSourceSnippet('MORROW_DASHBOARD/sprint-overview')

    expect(snippet).not.toBeNull()
    expect(snippet?.file).toBe('src/features/dashboard/SprintOverview.tsx')
    expect(snippet?.highlightLine).toBe(41)
    expect(snippet?.lines[snippet.highlightLine - snippet.startLine]).toContain(
      'id="sprint-overview"',
    )
  })

  it('maps a nested chip path to a deeper source line in the same file', () => {
    const snippet = getDemoSourceSnippet(
      'MORROW_DASHBOARD/sprint-overview/pill-design-system',
    )

    expect(snippet).not.toBeNull()
    expect(snippet?.file).toBe('src/features/dashboard/SprintOverview.tsx')
    expect(snippet?.highlightLine).toBe(61)
    expect(snippet?.lines[snippet.highlightLine - snippet.startLine]).toContain(
      'id="pill-design-system"',
    )
  })

  it('adds syntax tokens without injecting raw markup', () => {
    const markup = renderToStaticMarkup(
      <code>{highlightTsxLine('  return <DevTag id="safe">')}</code>,
    )

    expect(markup).toContain('source-token-keyword')
    expect(markup).toContain('source-token-tag')
    expect(markup).toContain('source-token-string')
    expect(markup).toContain('&lt;DevTag')
  })

  it('returns no invented excerpt for an unknown component', () => {
    expect(getDemoSourceSnippet('UNKNOWN/component')).toBeNull()
  })
})
