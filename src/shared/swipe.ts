/** A deliberate horizontal flick: far enough, mostly sideways, and quick. */
export const SWIPE_MIN_PX = 60
export const SWIPE_MAX_MS = 800
/** horizontal travel must be at least this many times the vertical travel */
const SWIPE_RATIO = 2

/**
 * Which way to page for a pointer gesture: +1 (next) for a swipe to the left,
 * -1 (previous) for a swipe to the right, null for anything else (a tap, a slow
 * drag, a mostly vertical move).
 */
export function swipeStep(dx: number, dy: number, ms: number): 1 | -1 | null {
  if (ms > SWIPE_MAX_MS) return null
  if (Math.abs(dx) < SWIPE_MIN_PX) return null
  if (Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)) return null
  return dx < 0 ? 1 : -1
}
