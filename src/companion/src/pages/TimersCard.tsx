import { useEffect, useState } from 'react'
import type { GameTimerDto } from '@shared/types'
import { timerTitle } from '@shared/gameTime'
import { formatDuration } from '@shared/timer'
import { useTimerMutations, useTimers, usePeople } from '../api/hooks'
import { PersonAvatar } from '../components/ui'

/** −5 / −1 / +1 / +5 minutes. */
const STEPS = [-5, -1, 1, 5] as const

/**
 * The kids' timers running on the tablet (Video Game Time, TV time…), at the top of every tab:
 * a live countdown each, and a parent can add or take off minutes or stop it. Taking off more than
 * is left ends it — the tablet then says it's up. (OPE-21, OPE-22)
 */
export function TimersCard() {
  const { data: timers = [] } = useTimers()
  const { data: people = [] } = usePeople()
  const mutations = useTimerMutations()
  const [now, setNow] = useState(() => Date.now())
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (timers.length === 0) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [timers.length])
  if (timers.length === 0) return null
  const left = (t: GameTimerDto): number => Math.max(0, Math.round((Date.parse(t.endsAt) - now) / 1000))
  const onError = (e: Error): void => setError(e.message)
  return (
    <div className="mb-4 rounded-card bg-ink p-4 text-paper shadow-card" data-timers-card>
      <h2 className="mb-1 font-display text-xl font-semibold">⏳ Timers</h2>
      {timers.map((t) => {
        const p = people.find((x) => x.id === t.personId)
        const secs = left(t)
        const up = secs === 0
        return (
          <div key={t.id} className="border-b border-paper/15 py-2.5 last:border-0" data-timer={t.id}>
            <div className="flex items-center gap-2.5">
              {p && <PersonAvatar name={p.name} color={p.color} size="sm" />}
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-base font-bold">{p?.name ?? 'Someone'}</span>
                <span className="block truncate text-xs font-bold text-paper/60">{timerTitle(t)}</span>
              </span>
              <span className="font-display text-3xl tabular-nums" data-timer-left>
                {up ? 'Up!' : formatDuration(secs)}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              {!up &&
                STEPS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={mutations.adjust.isPending}
                    onClick={() => mutations.adjust.mutate({ id: t.id, minutes: m }, { onError, onSuccess: () => setError(null) })}
                    aria-label={`${m > 0 ? 'Add' : 'Take off'} ${Math.abs(m)} min for ${p?.name ?? 'them'}`}
                    className="pressable min-h-10 flex-1 rounded-full bg-paper/15 text-sm font-extrabold tabular-nums disabled:opacity-40"
                  >
                    {m > 0 ? `+${m}` : `−${-m}`}
                  </button>
                ))}
              <button
                type="button"
                onClick={() => {
                  if (!up && confirming !== t.id) return setConfirming(t.id)
                  setConfirming(null)
                  mutations.stop.mutate({ id: t.id }, { onError })
                }}
                className={`pressable min-h-10 rounded-full px-3.5 text-sm font-extrabold ${
                  confirming === t.id ? 'bg-ember text-white' : 'bg-paper/15'
                } ${up ? 'flex-1' : ''}`}
              >
                {up ? 'Put away' : confirming === t.id ? 'Tap to stop' : 'Stop'}
              </button>
            </div>
          </div>
        )
      })}
      {error && <p className="mt-2 text-sm font-bold text-ember">{error}</p>}
    </div>
  )
}
