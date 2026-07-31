import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DevTag, DevTagRoot } from './DevTag.js'

describe('DevTag', () => {
  it('builds stable hierarchical paths for nested regions', () => {
    const markup = renderToStaticMarkup(
      <DevTagRoot pageId="DASHBOARD" enabled>
        <DevTag id="toolbar" type="panel">
          <span>Toolbar</span>
        </DevTag>
      </DevTagRoot>,
    )

    expect(markup).toContain('data-pixelprovenance-path="DASHBOARD"')
    expect(markup).toContain('data-pixelprovenance-path="DASHBOARD/toolbar"')
    expect(markup).toContain('data-pixelprovenance-type="panel"')
  })

  it('removes marker DOM while preserving children when disabled', () => {
    const markup = renderToStaticMarkup(
      <DevTagRoot pageId="DASHBOARD" enabled={false}>
        <DevTag id="toolbar"><span>Toolbar</span></DevTag>
      </DevTagRoot>,
    )

    expect(markup).toBe('<span>Toolbar</span>')
  })

  it('does not let a nested tag override a disabled root', () => {
    const markup = renderToStaticMarkup(
      <DevTagRoot pageId="DASHBOARD" enabled={false}>
        <DevTag id="toolbar" enabled><span>Toolbar</span></DevTag>
      </DevTagRoot>,
    )

    expect(markup).toBe('<span>Toolbar</span>')
  })

  it('supports the deprecated disabled prop without emitting markers', () => {
    const markup = renderToStaticMarkup(
      <DevTag id="toolbar" disabled><span>Toolbar</span></DevTag>,
    )
    expect(markup).toBe('<span>Toolbar</span>')
  })

  it('preserves layout props when signal rendering is disabled', () => {
    const markup = renderToStaticMarkup(
      <DevTag id="toolbar" enabled={false} className="grid-cell" style={{ order: 2 }}>
        <span>Toolbar</span>
      </DevTag>,
    )
    expect(markup).toBe(
      '<div class="grid-cell" style="position:relative;order:2"><span>Toolbar</span></div>',
    )
  })

  it('supports an explicit opt-in for demos built in production mode', () => {
    const previousNodeEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      const defaultMarkup = renderToStaticMarkup(
        <DevTagRoot pageId="DASHBOARD"><span>Dashboard</span></DevTagRoot>,
      )
      const optedInMarkup = renderToStaticMarkup(
        <DevTagRoot pageId="DASHBOARD" enabled><span>Dashboard</span></DevTagRoot>,
      )

      expect(defaultMarkup).toBe('<span>Dashboard</span>')
      expect(optedInMarkup).toContain('data-pixelprovenance-path="DASHBOARD"')
    } finally {
      process.env.NODE_ENV = previousNodeEnvironment
    }
  })

  it('can provide path context without painting a root signal', () => {
    const markup = renderToStaticMarkup(
      <DevTagRoot pageId="DASHBOARD" enabled signal={false}>
        <DevTag id="focus-card"><span>Focus</span></DevTag>
      </DevTagRoot>,
    )

    expect(markup).toContain('data-pixelprovenance-path="DASHBOARD/focus-card"')
    expect(markup.match(/data-pixelprovenance-signal/g)).toHaveLength(1)
  })

  it('surfaces the source location embedded into the region signal', () => {
    const markup = renderToStaticMarkup(
      <DevTag
        id="chip"
        enabled
        source={{ file: 'src/Chip.tsx', line: 8, column: 5 }}
      >
        <span>Chip</span>
      </DevTag>,
    )

    expect(markup).toContain(
      'data-pixelprovenance-source="src/Chip.tsx:8:5"',
    )
  })
})
