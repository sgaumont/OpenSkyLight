import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLICK_WAIT_MS, installTapFallback, LATE_CLICK_MS, type TapControl } from '../../src/shared/tapFallback'

/** A button that counts its clicks; `node` stands in for the DOM node a click targets. */
function button(): TapControl & { clicks: number; node: object; isConnected: boolean; disabled: boolean } {
  const node = {}
  return {
    clicks: 0,
    node,
    isConnected: true,
    disabled: false,
    click() {
      this.clicks++
    },
    contains: (n) => n === node
  }
}

let clock = 0
let doc: EventTarget
let under: TapControl | null
beforeEach(() => {
  vi.useFakeTimers()
  clock = 0
  doc = new EventTarget()
  under = null
  installTapFallback(doc, () => under, () => clock)
})
afterEach(() => {
  vi.useRealTimers()
})

function pointer(type: string, x = 0, y = 0, pointerType = 'touch'): void {
  doc.dispatchEvent(Object.assign(new Event(type), { pointerType, isPrimary: true, pointerId: 1, clientX: x, clientY: y }))
}

/** A real click from the browser on `b`; reports whether it reached the app. */
function browserClick(b: { node: object }): boolean {
  let reached = false
  const app = (): void => {
    reached = true
  }
  doc.addEventListener('click', app)
  const e = new Event('click', { cancelable: true })
  Object.defineProperty(e, 'target', { value: b.node })
  doc.dispatchEvent(e)
  doc.removeEventListener('click', app)
  return reached
}

function tap(b: TapControl, ms = 60): void {
  under = b
  pointer('pointerdown', 100, 100)
  clock += ms
  pointer('pointerup', 102, 101)
}

describe('tap fallback', () => {
  it('clicks the button when the browser drops the click of a tap', () => {
    const b = button()
    tap(b)
    vi.advanceTimersByTime(CLICK_WAIT_MS)
    expect(b.clicks).toBe(1)
  })

  it('does nothing extra when the browser clicks as usual', () => {
    const b = button()
    tap(b)
    expect(browserClick(b)).toBe(true)
    vi.advanceTimersByTime(CLICK_WAIT_MS * 3)
    expect(b.clicks).toBe(0)
  })

  it("swallows the browser's click if it turns up after the stand-in one", () => {
    const b = button()
    tap(b)
    vi.advanceTimersByTime(CLICK_WAIT_MS)
    clock += 200
    expect(browserClick(b)).toBe(false)
    // a later, separate tap is a new click
    clock += LATE_CLICK_MS
    expect(browserClick(b)).toBe(true)
  })

  it('leaves swipes, long presses, mouse clicks and finger slides off the button alone', () => {
    const b = button()
    under = b
    pointer('pointerdown', 100, 100)
    pointer('pointerup', 160, 100) // swipe
    tap(b, 1500) // long press
    pointer('pointerdown', 100, 100, 'mouse')
    pointer('pointerup', 100, 100, 'mouse')
    pointer('pointerdown', 100, 100)
    under = button() // lifted over a different button
    pointer('pointerup', 100, 100)
    vi.advanceTimersByTime(CLICK_WAIT_MS * 3)
    expect(b.clicks).toBe(0)
  })

  it('never clicks a button that went away or was disabled meanwhile', () => {
    const gone = button()
    tap(gone)
    gone.isConnected = false
    const off = button()
    vi.advanceTimersByTime(CLICK_WAIT_MS)
    tap(off)
    off.disabled = true
    vi.advanceTimersByTime(CLICK_WAIT_MS)
    expect(gone.clicks + off.clicks).toBe(0)
  })
})
