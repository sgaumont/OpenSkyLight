import { useEffect, useState } from 'react'
import type { GameTimerDto, PersonDto } from '@shared/types'
import { timerTitle } from '@shared/gameTime'
import { formatDuration } from '@shared/timer'
import { useTimerMutations, useTimers, usePeople } from '../api/hooks'
import { BottomSheet, PersonAvatar } from '../components/ui'

/** −5 / −1 / +1 / +5 minutes. */
const STEPS = [-5, -1, 1, 5] as const

/** Seconds left on a timer at `now` (0 = up). */
function secondsLeft(t: GameTimerDto, now: number): number {
  return Math.max(0, Math.round((Date.parse(t.endsAt) - now) / 1000))
}

/**
 * The kids' timers running on the tablet (Video Game Time, TV time…), pinned under the header on
 * every tab as one slim line each — name, what, live countdown. Tapping one opens its controls:
 * add or take off minutes, or stop it. (OPE-21/22; slimmed in v0.8.177 so tabs show their own
 * content first.)
 */
export function TimersStrip() {
  const { data: timers = [] } = useTimers()
  const { data: people = [] } = usePeople()
  const [now, setNow] = useState(() => Date.now())
  const [openId, setOpenId] = useState<string | null>(null)
  useEffect(() => {
    if (timers.length === 0) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [timers.length])
  if (timers.length === 0) return null
  const open = timers.find((t) => t.id === openId) ?? null
  return (
    <div className="mx-4 mb-2 flex flex-col gap-1.5" data-timers-card>
      {timers.map((t) => {
        const p = people.find((x) => x.id === t.personId)
        const secs = secondsLeft(t, now)
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setOpenId(t.id)}
            aria-label={`${p?.name ?? 'Timer'}: ${timerTitle(t)}, ${secs === 0 ? 'time is up' : formatDuration(secs) + ' left'}. Change it`}
            className={`pressable flex min-h-11 w-full items-center gap-2.5 rounded-2xl px-3 text-left shadow-card ${
              secs === 0 ? 'bg-ember text-white' : 'bg-ink text-paper'
            }`}
            data-timer={t.id}
          >
            <span aria-hidden="true">⏳</span>
            {p && <PersonAvatar name={p.name} color={p.color} size="sm" />}
            <span className="min-w-0 flex-1 truncate text-sm font-extrabold">
              {p?.name ?? 'Someone'} <span className="font-bold opacity-70">· {timerTitle(t)}</span>
            </span>
            <span className="font-display text-xl tabular-nums" data-timer-left>
              {secs === 0 ? 'Up!' : formatDuration(secs)}
            </span>
            <span aria-hidden="true" className="text-lg opacity-60">
              ›
            </span>
          </button>
        )
      })}
      {open && (
        <TimerSheet timer={open} person={people.find((x) => x.id === open.personId)} now={now} onClose={() => setOpenId(null)} />
      )}
    </div>
  )
}

/** One timer's controls: −5 / −1 / +1 / +5 and a two-tap Stop (Put away once it's up). */
function TimerSheet({
  timer,
  person,
  now,
  onClose
}: {
  timer: GameTimerDto
  person?: PersonDto
  now: number
  onClose: () => void
}) {
  const mutations = useTimerMutations()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const secs = secondsLeft(timer, now)
  const up = secs === 0
  const onError = (e: Error): void => setError(e.message)
  return (
    <BottomSheet onClose={onClose} label={`${person?.name ?? 'Timer'}: ${timerTitle(timer)}`}>
      <div className="flex items-center gap-3" data-timer-sheet>
        {person && <PersonAvatar name={person.name} color={person.color} />}
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-lg font-extrabold">{person?.name ?? 'Someone'}</span>
          <span className="block truncate text-sm font-bold text-ink-faint">{timerTitle(timer)}</span>
        </span>
        <span className="font-display text-4xl tabular-nums">{up ? 'Up!' : formatDuration(secs)}</span>
      </div>
      <div className="mt-4 flex items-center gap-2">
        {!up &&
          STEPS.map((m) => (
            <button
              key={m}
              type="button"
              disabled={mutations.adjust.isPending}
              onClick={() => mutations.adjust.mutate({ id: timer.id, minutes: m }, { onError, onSuccess: () => setError(null) })}
              aria-label={`${m > 0 ? 'Add' : 'Take off'} ${Math.abs(m)} min for ${person?.name ?? 'them'}`}
              className="pressable min-h-12 flex-1 rounded-full bg-paper-deep text-base font-extrabold tabular-nums disabled:opacity-40"
            >
              {m > 0 ? `+${m}` : `−${-m}`}
            </button>
          ))}
      </div>
      <button
        type="button"
        onClick={() => {
          if (!up && !confirming) return setConfirming(true)
          mutations.stop.mutate({ id: timer.id }, { onError, onSuccess: onClose })
        }}
        className={`pressable mt-3 min-h-12 w-full rounded-full text-base font-extrabold ${
          confirming || up ? 'bg-ember text-white' : 'bg-paper-deep text-ink'
        }`}
      >
        {up ? 'Put away' : confirming ? 'Tap again to stop' : 'Stop'}
      </button>
      {error && <p className="mt-2 text-sm font-bold text-ember-deep">{error}</p>}
      <button
        type="button"
        onClick={onClose}
        className="pressable mt-3 min-h-11 w-full rounded-full text-base font-bold text-ink-soft"
      >
        Close
      </button>
    </BottomSheet>
  )
}
