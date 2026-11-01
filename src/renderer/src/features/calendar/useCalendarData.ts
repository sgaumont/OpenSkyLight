import { useMemo } from 'react'
import { DateTime } from 'luxon'
import { agendaRange, dayRange, monthGridRange, weekViewRange, type DateRange } from '@shared/dates'
import type { CalendarDto, OccurrenceDto, PersonDto } from '@shared/types'
import { useCalendars, useOccurrences, usePeople, useSettings } from '../../api/hooks'
import { useUi, ZONE } from '../../stores/uiStore'
import { visibleWithFilters } from '../../lib/colors'

export function useWeekStartsOn(): 0 | 1 {
  const { data: settings } = useSettings()
  return settings?.weekStartsOn ?? 0
}

export function useWeekViewStart(): 'rolling' | 'fixed' {
  const { data: settings } = useSettings()
  return settings?.weekViewStart ?? 'rolling'
}

export function useViewRange(): DateRange {
  const view = useUi((s) => s.view)
  const focusedDate = useUi((s) => s.focusedDate)
  const weekStartsOn = useWeekStartsOn()
  const weekViewStart = useWeekViewStart()
  return useMemo(() => {
    switch (view) {
      case 'day':
        return dayRange(focusedDate, ZONE)
      case 'month':
        return monthGridRange(focusedDate, ZONE, weekStartsOn)
      case 'agenda':
        return agendaRange(focusedDate, ZONE)
      default:
        return weekViewRange(focusedDate, ZONE, weekViewStart, weekStartsOn)
    }
  }, [view, focusedDate, weekStartsOn, weekViewStart])
}

export interface CalendarData {
  occurrences: OccurrenceDto[]
  byDay: Map<string, OccurrenceDto[]>
  peopleById: Map<string, PersonDto>
  calendarsById: Map<string, CalendarDto>
  isLoading: boolean
}

export function useCalendarData(range: DateRange): CalendarData {
  const { data: occurrences, isLoading } = useOccurrences(range)
  const { data: people } = usePeople()
  const { data: calendars } = useCalendars()
  const hiddenPeople = useUi((s) => s.hiddenPeople)

  return useMemo(() => {
    const peopleById = new Map((people ?? []).map((p) => [p.id, p]))
    const calendarsById = new Map((calendars ?? []).map((c) => [c.id, c]))
    const visible = (occurrences ?? []).filter((o) => visibleWithFilters(o, hiddenPeople))

    const byDay = new Map<string, OccurrenceDto[]>()
    for (const occ of visible) {
      const start = DateTime.fromISO(occ.start, { zone: 'utc' }).setZone(ZONE)
      let endDay = DateTime.fromISO(occ.end, { zone: 'utc' }).setZone(ZONE)
      if (endDay > start) endDay = endDay.minus({ milliseconds: 1 })
      let cursor = start.startOf('day')
      const last = endDay.startOf('day')
      while (cursor <= last) {
        const key = cursor.toISODate()!
        const arr = byDay.get(key) ?? []
        arr.push(occ)
        byDay.set(key, arr)
        cursor = cursor.plus({ days: 1 })
      }
    }
    // all-day events first within each day, then by start time
    for (const arr of byDay.values()) {
      arr.sort((a, b) => (a.allDay === b.allDay ? (a.start < b.start ? -1 : 1) : a.allDay ? -1 : 1))
    }
    return { occurrences: visible, byDay, peopleById, calendarsById, isLoading }
  }, [occurrences, people, calendars, hiddenPeople, isLoading])
}
