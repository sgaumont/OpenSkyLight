import type { PersonDto, RecurrenceInput } from './types'

/** The chore editors' "Repeats" choice — shared by the kiosk and the companion so they can't drift. */
export type ScheduleKind = 'daily' | 'weekly' | 'once'

export function scheduleOf(recurrence: RecurrenceInput | null): ScheduleKind {
  if (!recurrence) return 'once'
  return recurrence.freq === 'weekly' ? 'weekly' : 'daily'
}

/** rrule weekdays: 0 = Monday … 6 = Sunday. Weekly with none picked falls back to Monday. */
export function toRecurrence(schedule: ScheduleKind, weekdays: number[]): RecurrenceInput | null {
  if (schedule === 'once') return null
  if (schedule === 'daily') return { freq: 'daily' }
  return { freq: 'weekly', byWeekdays: weekdays.length > 0 ? weekdays : [0] }
}

/**
 * The anchor to send when saving an existing chore: a chore switched to "One time" is due
 * `today` (its old anchor is its creation day, long past, so it would never show again).
 */
export function anchorOnSave(was: RecurrenceInput | null, schedule: ScheduleKind, today: string): string | undefined {
  return schedule === 'once' && was !== null ? today : undefined
}

/** Who an "everyone" chore or checklist starts with: the kids, or everybody if there are none. */
export function defaultAssignees(people: PersonDto[]): string[] {
  const kids = people.filter((p) => p.role === 'child')
  return (kids.length > 0 ? kids : people).map((p) => p.id)
}
