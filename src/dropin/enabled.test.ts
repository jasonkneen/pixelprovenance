import { describe, expect, it } from 'vitest'

import { isDropinEnabled } from './enabled.js'

describe('isDropinEnabled', () => {
  it('defaults on for loopback hosts', () => {
    expect(isDropinEnabled({ hostname: 'localhost' })).toBe(true)
    expect(isDropinEnabled({ hostname: '127.0.0.1' })).toBe(true)
    expect(isDropinEnabled({ hostname: '[::1]' })).toBe(true)
  })

  it('defaults off for public hosts', () => {
    expect(isDropinEnabled({ hostname: 'example.com' })).toBe(false)
  })

  it('honours an explicit flag over the host default', () => {
    expect(isDropinEnabled({ hostname: 'example.com', flag: 'true' })).toBe(true)
    expect(isDropinEnabled({ hostname: 'localhost', flag: 'false' })).toBe(false)
  })
})
