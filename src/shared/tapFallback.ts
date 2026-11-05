/**
 * Chromium sometimes drops the click of a perfectly good touch tap: the pointer events
 * arrive (down, up, on the same button) but no click follows. On the kiosk this showed up
 * as "the first tap doesn't register" right after swiping the Week view (OPE-16). This
 * clicks the button itself when the browser doesn't, and never lets one tap count twice.
 */

/** A control a tap can land on — a button, in practice. */
export interface TapControl {
  click(): void
  contains(node: unknown): boolean
  readonly isConnected: boolean
  readonly disabled?: boolean
}

interface PointerLike extends Event {
  pointerType?: string
  isPrimary?: boolean
  pointerId?: number
  clientX?: number
  clientY?: number
}

/** Finger movement (px) and press length (ms) that still count as a tap, not a swipe or hold. */
const TAP_SLOP_PX = 10
const TAP_MAX_MS = 700
/** How long to wait for the browser's own click after the finger lifts. */
export const CLICK_WAIT_MS = 120
/** A real click this soon after a stand-in one is the same tap arriving late — swallowed. */
export const LATE_CLICK_MS = 600

/**
 * Listens on `target` (capture phase). `controlAt` names the control under an event:
 * for pointerdown the one pressed, for pointerup the one under the lifted finger.
 * Returns a function that removes the listeners.
 */
export function installTapFallback(
  target: EventTarget,
  controlAt: (e: PointerLike) => TapControl | null,
  now: () => number = () => performance.now()
): () => void {
  let down: { id: number | undefined; x: number; y: number; at: number; control: TapControl } | null = null
  let pending: { control: TapControl; timer: ReturnType<typeof setTimeout> } | null = null
  let standIn: { control: TapControl; until: number } | null = null
  let clicking = false

  const clearPending = (): void => {
    if (pending) clearTimeout(pending.timer)
    pending = null
  }

  const onPointerDown = (ev: Event): void => {
    const e = ev as PointerLike
    down = null
    if (e.pointerType !== 'touch' || e.isPrimary === false) return
    const control = controlAt(e)
    if (control) down = { id: e.pointerId, x: e.clientX ?? 0, y: e.clientY ?? 0, at: now(), control }
  }

  const onPointerUp = (ev: Event): void => {
    const e = ev as PointerLike
    const d = down
    down = null
    if (!d || e.pointerId !== d.id) return
    const moved = Math.hypot((e.clientX ?? 0) - d.x, (e.clientY ?? 0) - d.y)
    if (moved > TAP_SLOP_PX || now() - d.at > TAP_MAX_MS) return
    // lifted off the same control it pressed
    if (controlAt(e) !== d.control) return
    clearPending()
    const control = d.control
    pending = {
      control,
      timer: setTimeout(() => {
        pending = null
        if (!control.isConnected || control.disabled) return
        standIn = { control, until: now() + LATE_CLICK_MS }
        clicking = true
        try {
          control.click()
        } finally {
          clicking = false
        }
      }, CLICK_WAIT_MS)
    }
  }

  const onCancel = (): void => {
    down = null
  }

  const onClick = (e: Event): void => {
    if (clicking) return // our own stand-in click
    if (pending && pending.control.contains(e.target)) {
      clearPending() // the browser delivered it after all
      return
    }
    if (standIn && now() < standIn.until && standIn.control.contains(e.target)) {
      e.preventDefault()
      e.stopImmediatePropagation()
      standIn = null
    }
  }

  const options = { capture: true }
  target.addEventListener('pointerdown', onPointerDown, options)
  target.addEventListener('pointerup', onPointerUp, options)
  target.addEventListener('pointercancel', onCancel, options)
  target.addEventListener('click', onClick, options)
  return () => {
    clearPending()
    target.removeEventListener('pointerdown', onPointerDown, options)
    target.removeEventListener('pointerup', onPointerUp, options)
    target.removeEventListener('pointercancel', onCancel, options)
    target.removeEventListener('click', onClick, options)
  }
}
