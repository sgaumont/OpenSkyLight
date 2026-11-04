import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { countdownLabel } from '@shared/countdown'
import { useCountdowns } from '../../api/hooks'
import { ZONE } from '../../stores/uiStore'
import type { TileProps } from '../home/tiles'

const todayIso = (): string => DateTime.now().setZone(ZONE).toISODate()!

/** Today's date, re-checked every minute so the days tick over at midnight. */
export function useTodayIso(): string {
  const [today, setToday] = useState(todayIso)
  useEffect(() => {
    const t = setInterval(() => setToday(todayIso()), 60_000)
    return () => clearInterval(t)
  }, [])
  return today
}

/** "🎄 Christmas · 51 days", soonest first — added in Settings or on the phone. */
export function CountdownsTile({ compact }: TileProps) {
  const today = useTodayIso()
  const { data: countdowns = [] } = useCountdowns()
  const shown = countdowns.map((c) => ({ ...c, label: countdownLabel(c.date, today) })).filter((c) => c.label)
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-1.5 shrink-0 text-xs font-extrabold tracking-wide text-ink-faint uppercase">Countdowns</div>
      {shown.length === 0 ? (
        <div className="flex h-full items-center justify-center p-2 text-center text-sm font-bold text-ink-faint">
          Add countdowns in Settings → General or on your phone
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
          {shown.map((c) => {
            const soon = c.label === 'Today!' || c.label === 'Tomorrow'
            return (
              <div
                key={c.id}
                data-countdown
                className={`flex items-center gap-2 rounded-lg px-2 py-1 ${soon ? 'bg-sun-soft' : 'bg-paper-deep/40'}`}
              >
                <span className={compact ? 'text-lg' : 'text-2xl'}>{c.emoji ?? '⏳'}</span>
                <span className={`min-w-0 flex-1 truncate font-bold ${compact ? 'text-sm' : 'text-base'}`}>{c.title}</span>
                <span className={`shrink-0 font-extrabold tabular-nums ${soon ? 'text-ember-deep' : 'text-ink-soft'} ${compact ? 'text-sm' : 'text-lg'}`}>
                  {c.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
