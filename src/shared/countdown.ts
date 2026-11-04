import { DateTime } from 'luxon'

/** Emojis offered when adding a countdown (the first is the default). */
export const COUNTDOWN_EMOJIS = ['⏳', '🎄', '🎂', '🎃', '✈️', '🏒', '🎉', '🏖️'] as const

/** Whole days from `today` to `date` (both ISO dates). */
export function daysUntil(date: string, today: string): number {
  return Math.round(DateTime.fromISO(date).diff(DateTime.fromISO(today), 'days').days)
}

/** "Today!", "Tomorrow", "5 days" — or null once the day has passed. */
export function countdownLabel(date: string, today: string): string | null {
  const n = daysUntil(date, today)
  if (n < 0) return null
  if (n === 0) return 'Today!'
  if (n === 1) return 'Tomorrow'
  return `${n} days`
}
