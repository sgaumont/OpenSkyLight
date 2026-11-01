import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { guardInput, WAKE_GUARD_MS } from '../../src/shared/inputGuard'

/** Fires `type` at `target` and reports whether a listener added after the guard saw it. */
function tap(target: EventTarget, type: string): { reachedUi: boolean; prevented: boolean } {
  let reachedUi = false
  const ui = (): void => {
    reachedUi = true
  }
  target.addEventListener(type, ui)
  const e = new Event(type, { cancelable: true })
  target.dispatchEvent(e)
  target.removeEventListener(type, ui)
  return { reachedUi, prevented: e.defaultPrevented }
}

describe('guardInput', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('swallows the rest of the waking tap', () => {
    const target = new EventTarget()
    guardInput(target)
    for (const type of ['pointerup', 'mouseup', 'click', 'touchend']) {
      expect(tap(target, type)).toEqual({ reachedUi: false, prevented: true })
    }
  })

  it('lets input through once the guard window has passed', () => {
    const target = new EventTarget()
    guardInput(target)
    vi.advanceTimersByTime(WAKE_GUARD_MS)
    expect(tap(target, 'click')).toEqual({ reachedUi: true, prevented: false })
  })

  it('restarts the window when the finger lifts, so a slow tap cannot leak through', () => {
    const target = new EventTarget()
    guardInput(target)
    vi.advanceTimersByTime(WAKE_GUARD_MS - 50)
    tap(target, 'pointerup')
    vi.advanceTimersByTime(WAKE_GUARD_MS - 50)
    expect(tap(target, 'click').reachedUi).toBe(false)
    vi.advanceTimersByTime(50)
    expect(tap(target, 'click').reachedUi).toBe(true)
  })

  it('can be ended early', () => {
    const target = new EventTarget()
    const stop = guardInput(target)
    stop()
    expect(tap(target, 'pointerdown').reachedUi).toBe(true)
  })
})
