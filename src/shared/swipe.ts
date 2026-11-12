import type { CalendarViewKind } from './types'

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

/** The tablet header's screen selector, left to right — what a sideways swipe steps through (OPE-23). */
export const SWIPE_TABS: CalendarViewKind[] = ['home', 'week', 'month', 'chats', 'lists']

/** The tab a swipe lands on: no wrap-around, and nothing from a screen outside the selector (Shop, Chores…). */
export function swipeTab(view: CalendarViewKind, step: 1 | -1): CalendarViewKind | null {
  const i = SWIPE_TABS.indexOf(view)
  if (i < 0) return null
  return SWIPE_TABS[i + step] ?? null
}
