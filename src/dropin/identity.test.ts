/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'

import {
  tagPatternSize,
  collectCodebook,
  cssSelectorFor,
  parseSource,
  resolveIdentity,
  resolveTarget,
} from './identity.js'

afterEach(() => {
  document.body.replaceChildren()
})

describe('parseSource', () => {
  it('reads file:line:column from the authoring attribute', () => {
    expect(parseSource('src/Pricing.tsx:88:9')).toEqual({
      file: 'src/Pricing.tsx',
      line: 88,
      column: 9,
    })
  })

  it('returns undefined for missing or malformed values', () => {
    expect(parseSource(undefined)).toBeUndefined()
    expect(parseSource('src/Pricing.tsx:88')).toBeUndefined()
  })
})

describe('resolveTarget', () => {
  it('ignores clicks on the toolbar', () => {
    const toolbar = document.createElement('div')
    toolbar.setAttribute('data-pp-toolbar', '')
    const button = document.createElement('button')
    button.textContent = 'Select'
    toolbar.append(button)
    document.body.append(toolbar)
    expect(resolveTarget(button)).toBeNull()
  })

  it('prefers the deepest data-pp ancestor', () => {
    const hero = document.createElement('section')
    hero.setAttribute('data-pp', 'hero')
    const cta = document.createElement('button')
    cta.setAttribute('data-pp', 'cta')
    const label = document.createElement('span')
    cta.append(label)
    hero.append(cta)
    document.body.append(hero)
    expect(resolveTarget(label)).toBe(cta)
  })

  it('falls back to data-testid then id', () => {
    const tagged = document.createElement('div')
    tagged.setAttribute('data-testid', 'plan-card')
    const inner = document.createElement('p')
    tagged.append(inner)
    document.body.append(tagged)
    expect(resolveTarget(inner)).toBe(tagged)

    const withId = document.createElement('nav')
    withId.id = 'workspace'
    const link = document.createElement('a')
    withId.append(link)
    document.body.append(withId)
    expect(resolveTarget(link)).toBe(withId)
  })
})

describe('resolveIdentity', () => {
  it('builds a page-prefixed path from nested data-pp segments', () => {
    const hero = document.createElement('section')
    hero.setAttribute('data-pp', 'hero')
    const cta = document.createElement('button')
    cta.setAttribute('data-pp', 'cta')
    cta.setAttribute('data-pp-type', 'button')
    cta.setAttribute('data-pp-source', 'src/Pricing.tsx:88:9')
    hero.append(cta)
    document.body.append(hero)

    expect(resolveIdentity(cta, 'pricing')).toEqual({
      path: 'pricing/hero/cta',
      type: 'button',
      depth: 3,
      selector: '[data-pp="cta"]',
      source: { file: 'src/Pricing.tsx', line: 88, column: 9 },
    })
  })
})

describe('cssSelectorFor', () => {
  it('uses a unique data-pp attribute when present', () => {
    const cta = document.createElement('button')
    cta.setAttribute('data-pp', 'cta')
    document.body.append(cta)
    expect(cssSelectorFor(cta)).toBe('[data-pp="cta"]')
  })
})

describe('collectCodebook', () => {
  it('lists live data-pp nodes as decoder descriptors', () => {
    const hero = document.createElement('section')
    hero.setAttribute('data-pp', 'hero')
    hero.setAttribute('data-pp-type', 'panel')
    const cta = document.createElement('button')
    cta.setAttribute('data-pp', 'cta')
    hero.append(cta)
    document.body.append(hero)

    expect(collectCodebook(document, 'pricing')).toEqual([
      {
        path: 'pricing/hero',
        type: 'panel',
        depth: 2,
        patternSize: 64,
      },
      {
        path: 'pricing/hero/cta',
        type: 'button',
        depth: 3,
        patternSize: 64,
      },
    ])
  })
})

describe('repeated tags', () => {
  function list(keys: Array<string | null>) {
    const ul = document.createElement('ul')
    ul.setAttribute('data-pp', 'list')
    for (const key of keys) {
      const row = document.createElement('li')
      row.setAttribute('data-pp', 'row')
      if (key) row.setAttribute('data-pp-key', key)
      const cta = document.createElement('button')
      cta.setAttribute('data-pp', 'cta')
      row.append(cta)
      ul.append(row)
    }
    document.body.append(ul)
    return ul
  }

  it('indexes same-name siblings so each row gets its own carrier', () => {
    list([null, null, null])
    expect(collectCodebook(document, 'app').map((entry) => entry.path)).toEqual([
      'app/list',
      'app/list/row[0]',
      'app/list/row[0]/cta',
      'app/list/row[1]',
      'app/list/row[1]/cta',
      'app/list/row[2]',
      'app/list/row[2]/cta',
    ])
  })

  it('uses data-pp-key as a stable suffix', () => {
    const ul = list(['a1', 'b2'])
    const second = ul.children[1] as HTMLElement
    expect(resolveIdentity(second, 'app').path).toBe('app/list/row[b2]')
    expect(cssSelectorFor(second)).toBe('[data-pp="row"][data-pp-key="b2"]')
  })

  it('falls back to a structural selector when names repeat', () => {
    const ul = list([null, null])
    const cta = ul.children[1].firstElementChild as HTMLElement
    const selector = cssSelectorFor(cta)
    expect(document.querySelectorAll(selector)).toHaveLength(1)
    expect(document.querySelector(selector)).toBe(cta)
  })

  it('never tags the drop-in signal layer', () => {
    const layer = document.createElement('div')
    layer.setAttribute('data-pp-signal-layer', '')
    const inner = document.createElement('div')
    inner.setAttribute('data-pp', 'ghost')
    layer.append(inner)
    document.body.append(layer)
    expect(collectCodebook(document, 'app')).toEqual([])
    expect(resolveTarget(inner)).toBeNull()
  })
})

describe('tagPatternSize', () => {
  function sized(width: number, height: number, explicit?: string) {
    const element = document.createElement('div')
    if (explicit) element.setAttribute('data-pp-pattern-size', explicit)
    element.getBoundingClientRect = () => ({
      x: 0, y: 0, width, height, left: 0, top: 0, right: width, bottom: height, toJSON() { return this },
    })
    return element
  }

  it('keeps the default tile on roomy elements', () => {
    expect(tagPatternSize(sized(400, 200))).toBe(64)
  })

  it('shrinks the tile on small controls, but not below 32px', () => {
    expect(tagPatternSize(sized(300, 70))).toBe(32)
    expect(tagPatternSize(sized(60, 35))).toBe(32)
    expect(tagPatternSize(sized(20, 20))).toBe(32)
  })

  it('honours an explicit data-pp-pattern-size', () => {
    expect(tagPatternSize(sized(60, 35, '48'))).toBe(48)
  })
})

