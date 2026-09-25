/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'

import { buildIdentityIndex } from './identity.js'
import { locateCrop } from './locate.js'

function place(element: HTMLElement, x: number, y: number, w: number, h: number) {
  element.getBoundingClientRect = () => ({
    x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h, toJSON() { return this },
  })
}

function scene() {
  const card = document.createElement('section')
  card.setAttribute('data-pp', 'card')
  card.setAttribute('data-pp-source', 'src/Card.tsx:4:3')
  const chip = document.createElement('span')
  chip.setAttribute('data-pp', 'chip')
  const button = document.createElement('button')
  button.setAttribute('data-pp', 'cta')
  card.append(chip, button)
  document.body.append(card)
  place(card, 0, 0, 400, 300)
  place(chip, 20, 20, 80, 24)
  place(button, 300, 240, 80, 40)
  return buildIdentityIndex(document, 'page')
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('locateCrop', () => {
  const scroll = { x: 0, y: 0 }

  it('names a chip from a crop inside it', () => {
    const [subject] = locateCrop({ x: 30, y: 24, w: 40, h: 16 }, scene(), scroll)
    expect(subject.path).toBe('page/card/chip')
    expect(subject.coverage).toBe(1)
  })

  it('names the chip from a loose crop around it', () => {
    const [subject] = locateCrop({ x: 14, y: 14, w: 92, h: 36 }, scene(), scroll)
    expect(subject.path).toBe('page/card/chip')
  })

  it('names the card, not a sliver of a neighbouring button', () => {
    const results = locateCrop({ x: 200, y: 180, w: 120, h: 80 }, scene(), scroll)
    expect(results[0].path).toBe('page/card')
    expect(results[0].source).toEqual({ file: 'src/Card.tsx', line: 4, column: 3 })
    expect(results.map((result) => result.path)).toContain('page/card/cta')
  })

  it('uses page coordinates after scrolling', () => {
    const [subject] = locateCrop({ x: 30, y: 1024, w: 40, h: 16 }, scene(), { x: 0, y: 1000 })
    expect(subject.path).toBe('page/card/chip')
  })
})
