/** Game time: controllers turn into minutes of play when a kid uses their time. */

/** Minutes added to every game timer for getting the console and game going. */
export const SETUP_MINUTES = 3

/** One controller is one minute of play (a 60-point Video Games set = an hour) — fixed, by request. */
export const MINUTES_PER_POINT = 1

/** How long a kid gets for `points` controllers: play time plus setup. */
export function gameMinutes(points: number): { play: number; total: number } {
  const play = Math.max(0, points) * MINUTES_PER_POINT
  return { play, total: play > 0 ? play + SETUP_MINUTES : 0 }
}

/**
 * Controllers back when a timer is stopped early: the time left, rounded up to a whole minute,
 * at 1 controller a minute — but never more than was spent (the setup minutes were free).
 */
export function refundPoints(msLeft: number, pointsSpent: number): number {
  if (msLeft <= 0) return 0
  return Math.min(Math.ceil(msLeft / 60_000) * MINUTES_PER_POINT, pointsSpent)
}

/** 63 → "1 h 03 min", 45 → "45 min". */
export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}
