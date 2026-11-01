import { describe, expect, it } from 'vitest'
import { SWIPE_MAX_MS, SWIPE_MIN_PX, swipeStep } from '../../src/shared/swipe'

describe('swipeStep', () => {
  it('swipe left pages forward, swipe right pages back', () => {
    expect(swipeStep(-120, 10, 200)).toBe(1)
    expect(swipeStep(120, -10, 200)).toBe(-1)
  })
  it('ignores taps and short moves', () => {
    expect(swipeStep(0, 0, 80)).toBeNull()
    expect(swipeStep(-(SWIPE_MIN_PX - 1), 0, 200)).toBeNull()
  })
  it('ignores mostly vertical moves (scrolling)', () => {
    expect(swipeStep(-100, 80, 200)).toBeNull()
  })
  it('ignores slow drags', () => {
    expect(swipeStep(-200, 0, SWIPE_MAX_MS + 1)).toBeNull()
  })
})
