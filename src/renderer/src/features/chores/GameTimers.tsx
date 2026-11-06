import { useEffect, useState } from 'react'
import type { GameTimerDto } from '@shared/types'
import { formatDuration } from '@shared/timer'
import { useGameTimers, usePeople, useStopGameTimer } from '../../api/hooks'
import { StarIcon } from '../../components/icons'
import { startAlarm, stopAlarm } from '../../lib/alarm'
import { initials, textOn } from '../../lib/format'
import { useKioskState } from '../../stores/kioskStore'
import { useToasts } from '../../stores/toastStore'

/**
 * Kids' game time counting down: a pill each at the bottom of the screen (every screen, and over
 * the screensaver). When one runs out, a "time's up" card and the timer chime until someone taps OK
 * (quiet while the sleep screen is up).
 */
export function GameTimers() {
  const { data: timers = [] } = useGameTimers()
  const { data: people = [] } = usePeople()
  const stop = useStopGameTimer()
  const pushToast = useToasts((s) => s.push)
  const sleeping = useKioskState((s) => s.sleeping)
  const [now, setNow] = useState(() => Date.now())
  const [confirming, setConfirming] = useState<string | null>(null)
  useEffect(() => {
    if (timers.length === 0) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [timers.length])

  const left = (t: GameTimerDto): number => Math.max(0, Math.round((Date.parse(t.endsAt) - now) / 1000))
  const running = timers.filter((t) => left(t) > 0)
  const done = timers.filter((t) => left(t) === 0)
  const ringing = done.length > 0 && !sleeping
  useEffect(() => {
    if (!ringing) return
    startAlarm()
    return () => stopAlarm()
  }, [ringing])

  const personOf = (id: string) => people.find((p) => p.id === id)
  if (timers.length === 0) return null
  const up = done[0]
  const upPerson = up ? personOf(up.personId) : undefined

  return (
    <>
      {running.length > 0 && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-5 z-[83] flex justify-center gap-3"
          // taps on a pill never count as a tap on the screensaver underneath
          onPointerDown={(e) => e.stopPropagation()}
        >
          {running.map((t) => {
            const p = personOf(t.personId)
            const armed = confirming === t.id
            return (
              <div
                key={t.id}
                data-game-timer
                className="pointer-events-auto flex items-center gap-3 rounded-full bg-ink/90 py-2 pr-2 pl-2 text-paper shadow-float backdrop-blur-sm"
              >
                {p && (
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-extrabold"
                    style={{ backgroundColor: p.color, color: textOn(p.color) }}
                  >
                    {initials(p.name)}
                  </span>
                )}
                <span className="text-lg font-bold">
                  <StarIcon /> {p?.name ?? 'Game time'}
                </span>
                <span className="min-w-20 text-center font-display text-3xl tabular-nums" data-left>
                  {formatDuration(left(t))}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (!armed) return setConfirming(t.id)
                    setConfirming(null)
                    stop.mutate(
                      { id: t.id },
                      // the time left goes back on their balance
                      { onSuccess: (res) => res.refunded > 0 && pushToast(`🎮 ${res.refunded} back to ${p?.name ?? 'them'}`) }
                    )
                  }}
                  onBlur={() => setConfirming(null)}
                  className={`pressable rounded-full px-4 py-2 text-sm font-extrabold ${armed ? 'bg-ember text-white' : 'bg-paper/15 text-paper'}`}
                >
                  {armed ? 'Tap again to stop' : 'Stop'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {up && (
        <div
          className="fixed inset-0 z-[83] flex items-center justify-center bg-ink/55 p-10 backdrop-blur-sm"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            role="alertdialog"
            aria-label="Game time is up"
            className="animate-pop flex w-full max-w-xl flex-col items-center gap-6 rounded-3xl bg-card px-10 py-9 text-center shadow-float ring-2 ring-ember"
          >
            <span className="text-6xl text-ember">
              <StarIcon />
            </span>
            <p className="font-display text-4xl leading-tight">
              {upPerson ? `${upPerson.name}'s` : 'Your'} game time is up!
            </p>
            <button
              type="button"
              onClick={() => stop.mutate({ id: up.id })}
              className="pressable min-h-16 w-full rounded-2xl bg-ember text-2xl font-extrabold text-white shadow-card"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </>
  )
}
