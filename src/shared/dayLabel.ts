import { DateTime } from 'luxon'

/** How long ago a day was, for "finished … yesterday": '' for today, then "yesterday", then "Mon Nov 3". */
export function dayLabel(date: string, today: string): string {
  if (date === today) return ''
  const d = DateTime.fromISO(date)
  if (d.plus({ days: 1 }).toISODate() === today) return 'yesterday'
  return d.toFormat('ccc LLL d')
}
