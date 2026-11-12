import { describe, expect, it } from 'vitest'
import { SWIPE_MAX_MS, SWIPE_MIN_PX, swipeStep, swipeTab } from '../../src/shared/swipe'

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

describe('tablet tab swipe (OPE-23)', () => {
  it('steps through the header screens in order, without wrapping', () => {
    expect(swipeTab('home', 1)).toBe('week')
    expect(swipeTab('month', 1)).toBe('chats')
    expect(swipeTab('chats', -1)).toBe('month')
    expect(swipeTab('lists', 1)).toBeNull()
    expect(swipeTab('home', -1)).toBeNull()
  })
  it('does nothing from a screen that is not in the selector', () => {
    expect(swipeTab('shop', 1)).toBeNull()
    expect(swipeTab('chores', -1)).toBeNull()
  })
})
