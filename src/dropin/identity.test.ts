/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'

import {
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
      },
      {
        path: 'pricing/hero/cta',
        type: 'button',
        depth: 3,
      },
    ])
  })
})
