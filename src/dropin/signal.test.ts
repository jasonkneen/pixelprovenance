/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applySignals } from './signal.js'

function place(element: HTMLElement, x: number, y: number, w: number, h: number) {
  element.getBoundingClientRect = () => ({
    x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h, toJSON() { return this },
  })
}

const OPTIONS = { intensity: 0.06, patternSize: 64, debug: false }
let stop: (() => void) | null = null

afterEach(() => {
  stop?.()
  stop = null
  document.body.replaceChildren()
})

function tiles() {
  return [...document.querySelectorAll<HTMLElement>('[data-pp-signal-layer] > [data-pixelprovenance-signal]')]
}

describe('applySignals overlay', () => {
  it('paints carriers in one layer without touching host elements', () => {
    const card = document.createElement('section')
    card.setAttribute('data-pp', 'card')
    const avatar = document.createElement('img')
    avatar.setAttribute('data-pp', 'avatar')
    card.append(avatar)
    document.body.append(card)
    place(card, 10, 20, 300, 200)
    place(avatar, 30, 40, 48, 48)
    const before = card.outerHTML

    stop = applySignals(document, 'app', OPTIONS)

    expect(card.outerHTML).toBe(before)
    expect(card.style.position).toBe('')
    expect(tiles().map((tile) => tile.getAttribute('data-pixelprovenance-path'))).toEqual([
      'app/card',
      'app/card/avatar',
    ])
    const avatarTile = tiles()[1]
    expect(avatarTile.style.left).toBe('30px')
    expect(avatarTile.style.width).toBe('48px')
    expect(Number(avatarTile.style.zIndex)).toBeGreaterThan(Number(tiles()[0].style.zIndex))
  })

  it('tags elements added after mount and drops removed ones', async () => {
    stop = applySignals(document, 'app', OPTIONS)
    const late = document.createElement('div')
    late.setAttribute('data-pp', 'late')
    place(late, 0, 0, 100, 100)
    document.body.append(late)
    await vi.waitFor(() => expect(tiles()).toHaveLength(1))
    late.remove()
    await vi.waitFor(() => expect(tiles()).toHaveLength(0))
  })

  it('clips a carrier to an overflow-hidden ancestor and keeps its tile phase', () => {
    const scroller = document.createElement('div')
    scroller.style.overflow = 'hidden'
    const row = document.createElement('div')
    row.setAttribute('data-pp', 'row')
    scroller.append(row)
    document.body.append(scroller)
    place(scroller, 0, 100, 200, 100)
    place(row, 0, 60, 200, 80)

    stop = applySignals(document, 'app', OPTIONS)

    const [tile] = tiles()
    expect(tile.style.top).toBe('100px')
    expect(tile.style.height).toBe('40px')
    expect(tile.style.backgroundPosition).toBe('0px -40px')
  })

  it('does not double-paint a node that has a DevTag signal child', () => {
    const tagged = document.createElement('div')
    tagged.setAttribute('data-pp', 'react')
    const devTagSignal = document.createElement('span')
    devTagSignal.setAttribute('data-pixelprovenance-signal', '')
    tagged.append(devTagSignal)
    document.body.append(tagged)
    place(tagged, 0, 0, 200, 200)
    stop = applySignals(document, 'app', OPTIONS)
    expect(tiles()[0].style.display).toBe('none')
  })

  it('removes its layer on stop', () => {
    const tagged = document.createElement('div')
    tagged.setAttribute('data-pp', 'x')
    document.body.append(tagged)
    place(tagged, 0, 0, 10, 10)
    const cleanup = applySignals(document, 'app', OPTIONS)
    cleanup()
    expect(document.querySelector('[data-pp-signal-layer]')).toBeNull()
  })
})
