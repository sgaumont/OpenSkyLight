import { useState } from 'react'
import type { CalendarDto, OccurrenceDto } from '@shared/types'
import { useCalendarMutations } from '../../api/hooks'
import { formatTime } from '../../lib/format'
import { BigButton, Dialog } from '../../components/ui'
import { OskInput } from '../../components/Osk'

const QUICK = [0, 15, 30, 45, 60]

/** "Arrive 5:14" under an event whose calendar says to be there early. */
export function ArriveBy({
  occ,
  timeFormat,
  long = false,
  className = ''
}: {
  occ: Pick<OccurrenceDto, 'arriveBy'>
  timeFormat: '12h' | '24h'
  long?: boolean
  className?: string
}) {
  if (!occ.arriveBy) return null
  return (
    <div className={`truncate font-bold text-ink-soft ${className}`} data-arrive-by>
      ⏱ {long ? 'Arrive by' : 'Arrive'} {formatTime(occ.arriveBy, timeFormat)}
    </div>
  )
}

/**
 * Settings → Calendars: a chip on each calendar row for its arrival offset ("Arrive 46 min early"),
 * opening a picker with quick choices and any number of minutes up to 4 hours.
 */
export function ArriveOffsetChip({ calendar }: { calendar: CalendarDto }) {
  const mutations = useCalendarMutations()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const value = draft === '' ? NaN : Number(draft)
  const valid = Number.isInteger(value) && value >= 0 && value <= 240
  const save = (minutes: number): void => {
    mutations.update.mutate({ id: calendar.id, arriveOffsetMinutes: minutes })
    setOpen(false)
  }
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(String(calendar.arriveOffsetMinutes))
          setOpen(true)
        }}
        className="pressable shrink-0 rounded-full bg-card px-3.5 py-1.5 text-sm font-bold text-ink-soft shadow-card"
        data-arrive-chip
      >
        ⏱ {calendar.arriveOffsetMinutes > 0 ? `Arrive ${calendar.arriveOffsetMinutes} min early` : 'Arrive on time'}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Arrive early · ${calendar.name}`}>
        <div className="flex flex-col gap-4">
          <p className="text-base font-semibold text-ink-soft">
            Events on this calendar show “Arrive by” this many minutes before they start (leave-by times count back from
            it). All-day events are left alone.
          </p>
          <div className="flex flex-wrap gap-2">
            {QUICK.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => save(m)}
                className={`pressable rounded-full px-5 py-2.5 text-lg font-extrabold ${
                  calendar.arriveOffsetMinutes === m ? 'bg-ember text-white' : 'bg-paper-deep text-ink'
                }`}
              >
                {m === 0 ? 'On time' : `${m} min`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-base font-bold text-ink-soft">Other:</span>
            <div className="w-28">
              <OskInput value={draft} onChange={(v) => setDraft(v.replace(/\D/g, '').slice(0, 3))} placeholder="46" />
            </div>
            <span className="text-base font-bold text-ink-soft">minutes early</span>
            <div className="flex-1" />
            <BigButton disabled={!valid} onClick={() => save(value)}>
              Save
            </BigButton>
          </div>
        </div>
      </Dialog>
    </>
  )
}
