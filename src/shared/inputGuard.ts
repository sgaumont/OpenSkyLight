/** Every event a tap can produce, including the mouse events touchscreens synthesize. */
const TAP_EVENTS = [
  'pointerdown',
  'pointerup',
  'pointercancel',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
  'touchstart',
  'touchend'
] as const

const RELEASE_EVENTS: ReadonlySet<string> = new Set(['pointerup', 'pointercancel', 'touchend'])

export const WAKE_GUARD_MS = 300

/**
 * Swallows taps on `target` (capture phase) so the tap that dismissed an overlay
 * never reaches the UI underneath. Input is ignored until `ms` after the last
 * finger lift — or `ms` after the guard starts, if no lift is seen.
 * Returns a function that ends the guard early.
 */
export function guardInput(target: EventTarget, ms = WAKE_GUARD_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const options = { capture: true, passive: false }

  const swallow = (e: Event): void => {
    e.preventDefault()
    e.stopImmediatePropagation()
    if (RELEASE_EVENTS.has(e.type)) arm()
  }

  const stop = (): void => {
    clearTimeout(timer)
    for (const type of TAP_EVENTS) target.removeEventListener(type, swallow, options)
  }

  const arm = (): void => {
    clearTimeout(timer)
    timer = setTimeout(stop, ms)
  }

  for (const type of TAP_EVENTS) target.addEventListener(type, swallow, options)
  arm()
  return stop
}
