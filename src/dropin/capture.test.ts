import { describe, expect, it } from 'vitest'

import { sliceGeometry } from './capture.js'

describe('sliceGeometry', () => {
  it('subtracts where the captured root sits on the page', () => {
    // <body> with the default 8px margin, captured at 1×.
    const geometry = sliceGeometry(
      { width: 784, height: 1000 },
      { x: 108, y: 58, w: 100, h: 50 },
      { x: 8, y: 8, width: 784, height: 1000 },
    )
    expect(geometry).toMatchObject({ left: 100, top: 50, width: 100, height: 50, scale: 1 })
  })

  it('scales a page-coordinate crop into a 2× canvas', () => {
    const geometry = sliceGeometry(
      { width: 1568, height: 2000 },
      { x: 108, y: 58, w: 100, h: 50 },
      { x: 8, y: 8, width: 784, height: 1000 },
    )
    expect(geometry).toMatchObject({ left: 200, top: 100, width: 200, height: 100, scale: 2 })
  })

  it('clamps a crop that runs past the canvas edge', () => {
    const geometry = sliceGeometry(
      { width: 100, height: 100 },
      { x: 80, y: 80, w: 50, h: 50 },
      { x: 0, y: 0, width: 100, height: 100 },
    )
    expect(geometry).toMatchObject({ left: 80, top: 80, width: 20, height: 20 })
  })
})
