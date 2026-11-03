import { DateTime } from 'luxon'

/** Chore completions are kept (and shown in the history) for today and the days before it, this many in all. */
export const CHORE_HISTORY_DAYS = 3

/** The history's dates, newest first: today, yesterday, … (ISO dates in `zone`). */
export function choreHistoryDates(today: string, zone: string): string[] {
  const d = DateTime.fromISO(today, { zone })
  return Array.from({ length: CHORE_HISTORY_DAYS }, (_, i) => d.minus({ days: i }).toISODate()!)
}

/** Completions due before this date are purged (the oldest day still kept). */
export function choreHistoryCutoff(today: string, zone: string): string {
  return choreHistoryDates(today, zone)[CHORE_HISTORY_DAYS - 1]
}
