import { useEffect, useState } from 'react'
import { useLeaveTimes, useSettings } from '../../api/hooks'
import { formatTime } from '../../lib/format'
import { useKioskState } from '../../stores/kioskStore'
import { startLeaveChime, stopLeaveChime } from '../../lib/alarm'

/** How often the banner checks the clock. */
const TICK_MS = 15_000

/**
 * "Time to leave" banner across the top of every screen (screensaver too, not the sleep screen),
 * from the leave-by time until the event starts or someone taps Got it. Chimes when it appears
 * and every minute after while it's up.
 */
export function LeaveOverlay() {
  const { data: leaveTimes = [] } = useLeaveTimes()
  const { data: settings } = useSettings()
  const sleeping = useKioskState((s) => s.sleeping)
  const [now, setNow] = useState(() => Date.now())
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [])

  // the soonest trip whose leave time has come and that hasn't started yet
  const due = leaveTimes.find((t) => Date.parse(t.leaveAt) <= now && Date.parse(t.start) > now && !dismissed.has(t.key))
  const ringing = !!due && !sleeping
  useEffect(() => {
    if (!ringing) return
    startLeaveChime()
    return () => stopLeaveChime()
  }, [ringing, due?.key])

  if (!due || sleeping) return null
  const timeFormat = settings?.timeFormat ?? '12h'
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[86] flex justify-center px-6" data-leave-banner>
      <div
        className="pointer-events-auto flex max-w-[60rem] items-center gap-5 rounded-3xl bg-ember px-7 py-5 text-white shadow-float"
        style={{ animation: 'fade-in 0.4s ease both' }}
      >
        <span className="text-5xl" aria-hidden>
          🚗
        </span>
        <div className="min-w-0">
          <div className="truncate text-3xl font-extrabold">Time to leave for {due.title}</div>
          <div className="truncate text-lg font-bold text-white/85">
            {due.driveMinutes} min drive to {due.location} · starts {formatTime(due.start, timeFormat)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed((d) => new Set(d).add(due.key))}
          className="pressable ml-2 min-h-14 shrink-0 rounded-2xl bg-white px-6 text-xl font-extrabold text-ember-deep"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
