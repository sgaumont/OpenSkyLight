import { DateTime } from 'luxon'
import { eachDay } from '@shared/dates'
import { useUi, ZONE } from '../../stores/uiStore'
import { occurrenceColor } from '../../lib/colors'
import { isToday, textOn } from '../../lib/format'
import { useCalendarData, useViewRange } from './useCalendarData'
import { useSwipe } from '../../lib/useSwipe'

const MAX_PILLS = 3

export function MonthView() {
  const range = useViewRange()
  const { byDay, peopleById, calendarsById } = useCalendarData(range)
  const focusedDate = useUi((s) => s.focusedDate)
  const setFocusedDate = useUi((s) => s.setFocusedDate)
  const setView = useUi((s) => s.setView)
  const step = useUi((s) => s.step)
  const days = eachDay(range, ZONE)
  const focusedMonth = DateTime.fromISO(focusedDate, { zone: ZONE }).month

  const openDay = (key: string): void => {
    setFocusedDate(key)
    setView('day')
  }
  // swipe left = next month, right = previous (same as the header arrows)
  const swipe = useSwipe(step)

  return (
    <div className="flex h-full flex-col px-6 pb-6" {...swipe}>
      <div className="grid grid-cols-7 gap-x-2 pb-1">
        {days.slice(0, 7).map((d) => (
          <div key={d.toISODate()} className="px-2 text-sm font-extrabold uppercase text-ink-faint">
            {d.toFormat('ccc')}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-2">
        {days.map((day, i) => {
          const key = day.toISODate()!
          const occurrences = byDay.get(key) ?? []
          const today = isToday(key)
          const inMonth = day.month === focusedMonth
          const overflow = occurrences.length - MAX_PILLS
          return (
            <button
              key={key}
              type="button"
              onClick={() => openDay(key)}
              className={`animate-rise pressable flex min-h-0 flex-col overflow-hidden rounded-2xl p-1.5 text-left ${
                today ? 'bg-sun-soft ring-2 ring-sun' : inMonth ? 'bg-card/80 shadow-card' : 'bg-paper-deep/30'
              }`}
              style={{ animationDelay: `${Math.min(i * 12, 400)}ms` }}
            >
              <span
                className={`mb-1 flex h-8 w-8 items-center justify-center rounded-full font-display text-lg ${
                  today ? 'bg-ember text-white' : inMonth ? 'text-ink' : 'text-ink-faint'
                }`}
              >
                {day.day}
              </span>
              <span className="flex min-h-0 flex-col gap-1 overflow-hidden">
                {occurrences.slice(0, MAX_PILLS).map((occ) => {
                  const color = occurrenceColor(occ, peopleById, calendarsById)
                  return (
                    <span
                      key={occ.key}
                      className="truncate rounded-md px-1.5 py-0.5 text-xs font-bold"
                      style={
                        occ.allDay
                          ? { backgroundColor: color, color: textOn(color) }
                          : { backgroundColor: 'transparent', color: 'var(--color-ink)', borderLeft: `3px solid ${color}` }
                      }
                    >
                      {occ.title}
                    </span>
                  )
                })}
                {overflow > 0 && <span className="px-1.5 text-xs font-extrabold text-ink-faint">+{overflow} more</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
