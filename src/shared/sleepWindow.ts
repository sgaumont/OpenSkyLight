/** Pure sleep-window math (supports overnight ranges like 21:30 → 06:30). */

export function parseHhMm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** A screen woken during the sleep window goes back to sleep after this long untouched. */
export const WAKE_IDLE_SECONDS = 5 * 60

/**
 * Whether a tap-to-wake should still hold the screen awake: it lasts while the
 * screen is being used (any input within WAKE_IDLE_SECONDS) and ends with the window.
 */
export function stillAwake(awake: boolean, inWindow: boolean, idleSeconds: number): boolean {
  return awake && inWindow && idleSeconds < WAKE_IDLE_SECONDS
}

/** Is `nowMinutes` (minutes since local midnight) inside [start, end)? */
export function isInSleepWindow(nowMinutes: number, start: string, end: string): boolean {
  const s = parseHhMm(start)
  const e = parseHhMm(end)
  if (s === null || e === null || s === e) return false
  if (s < e) return nowMinutes >= s && nowMinutes < e
  // overnight window
  return nowMinutes >= s || nowMinutes < e
}
