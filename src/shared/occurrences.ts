import type { OccurrenceDto } from './types'

type Timing = Pick<OccurrenceDto, 'allDay' | 'end'>

/** A timed occurrence is over once its end instant has passed; all-day ones stay up all day. */
export function hasEnded(occ: Timing, nowMs: number): boolean {
  return !occ.allDay && Date.parse(occ.end) <= nowMs
}

/** Drops timed occurrences that have already finished, keeping all-day and in-progress ones. */
export function withoutEnded<T extends Timing>(occurrences: T[], nowMs: number): T[] {
  return occurrences.filter((o) => !hasEnded(o, nowMs))
}
