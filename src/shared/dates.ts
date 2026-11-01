import { DateTime } from 'luxon'

/** Canonical UTC ISO format used everywhere in the app (no milliseconds). */
export function isoUtc(dt: DateTime): string {
  const s = dt.toUTC().toISO({ suppressMilliseconds: true })
  if (!s) throw new Error('Invalid DateTime')
  return s
}

export function fromIso(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: 'utc' })
}

/** ISO calendar date (YYYY-MM-DD) in the given zone */
export function localDateKey(iso: string, zone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone).toISODate()!
}

export interface DateRange {
  /** inclusive, UTC ISO */
  start: string
  /** exclusive, UTC ISO */
  end: string
}

/** The week containing `dateIso` (a YYYY-MM-DD in the device zone). */
export function weekRange(dateIso: string, zone: string, weekStartsOn: 0 | 1): DateRange {
  const d = DateTime.fromISO(dateIso, { zone }).startOf('day')
  // luxon weekday: 1 = Monday .. 7 = Sunday
  const target = weekStartsOn === 0 ? 7 : 1
  let start = d
  while (start.weekday !== target) start = start.minus({ days: 1 })
  return { start: isoUtc(start), end: isoUtc(start.plus({ days: 7 })) }
}

/**
 * The 7 days the week view shows: starting on `dateIso` itself when rolling,
 * otherwise the calendar week containing it.
 */
export function weekViewRange(
  dateIso: string,
  zone: string,
  start: 'rolling' | 'fixed',
  weekStartsOn: 0 | 1
): DateRange {
  return start === 'rolling' ? agendaRange(dateIso, zone, 7) : weekRange(dateIso, zone, weekStartsOn)
}

export function dayRange(dateIso: string, zone: string): DateRange {
  const d = DateTime.fromISO(dateIso, { zone }).startOf('day')
  return { start: isoUtc(d), end: isoUtc(d.plus({ days: 1 })) }
}

/** Full grid for a month view: starts on the week boundary at/before the 1st, 6 weeks long. */
export function monthGridRange(dateIso: string, zone: string, weekStartsOn: 0 | 1): DateRange {
  const first = DateTime.fromISO(dateIso, { zone }).startOf('month')
  const { start } = weekRange(first.toISODate()!, zone, weekStartsOn)
  const gridStart = DateTime.fromISO(start, { zone: 'utc' }).setZone(zone)
  return { start: isoUtc(gridStart), end: isoUtc(gridStart.plus({ weeks: 6 })) }
}

export function agendaRange(dateIso: string, zone: string, days = 14): DateRange {
  const d = DateTime.fromISO(dateIso, { zone }).startOf('day')
  return { start: isoUtc(d), end: isoUtc(d.plus({ days })) }
}

export function eachDay(range: DateRange, zone: string): DateTime[] {
  const out: DateTime[] = []
  let cur = DateTime.fromISO(range.start, { zone: 'utc' }).setZone(zone)
  const end = DateTime.fromISO(range.end, { zone: 'utc' }).setZone(zone)
  while (cur < end) {
    out.push(cur)
    cur = cur.plus({ days: 1 })
  }
  return out
}
