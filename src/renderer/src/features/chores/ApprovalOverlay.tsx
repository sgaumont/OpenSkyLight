import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import type { PendingUnlockDto } from '@shared/types'
import { dayLabel } from '@shared/dayLabel'
import { useAuthMutations, useAuthStatus, useChecklistMutations, usePendingUnlocks, usePeople } from '../../api/hooks'
import { PinDialog } from '../../components/PinDialog'
import { GameIcon } from '../../components/icons'
import { ZONE } from '../../stores/uiStore'

/** "Not now" hides a request this long, then it asks again — until a parent approves it. */
const SNOOZE_MS = 30 * 60_000

const keyOf = (u: PendingUnlockDto): string => `${u.personId}:${u.date}:${u.round ?? 0}`

/**
 * A finished Video Games set waiting for a parent, centred over the kiosk (and the screensaver,
 * under the note pop-up) so it can't be missed. Approve asks for the parent PIN when one is set.
 */
export function ApprovalOverlay() {
  const today = DateTime.now().setZone(ZONE).toISODate()!
  const { data: pending = [] } = usePendingUnlocks(today)
  const { data: people = [] } = usePeople()
  const { data: auth } = useAuthStatus()
  const authMutations = useAuthMutations()
  const { approve } = useChecklistMutations()
  const [snoozed, setSnoozed] = useState<Record<string, number>>({})
  const [askPin, setAskPin] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)
  // re-checked every minute so a snoozed request comes back
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const waiting = pending.filter((u) => u.kind === 'videogames' && (snoozed[keyOf(u)] ?? 0) <= now)
  const u = waiting[0]
  if (!u) return null
  const name = people.find((p) => p.id === u.personId)?.name ?? 'Someone'
  const when = dayLabel(u.date, today)
  const locked = (auth?.pinSet ?? false) && !(auth?.unlocked ?? false)

  const doApprove = (): void => {
    approve.mutate(
      { checklistId: u.checklistId, personId: u.personId, date: u.date, round: u.round },
      // put the parental lock back on straight away, as closing Settings does
      { onSettled: () => auth?.pinSet && authMutations.lock.mutate(undefined) }
    )
  }

  return (
    <div
      className="fixed inset-0 z-[84] flex items-center justify-center bg-ink/55 p-10 backdrop-blur-sm"
      // taps here belong to the request, never to the screensaver or screen underneath
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        role="alertdialog"
        aria-label="Waiting for a parent"
        className="animate-pop flex w-full max-w-2xl flex-col items-center gap-6 rounded-3xl bg-card px-10 py-9 text-center shadow-float ring-2 ring-sun"
      >
        <div className="text-base font-extrabold tracking-wider text-ink-faint uppercase">
          Waiting for a parent{waiting.length > 1 ? ` · 1 of ${waiting.length}` : ''}
        </div>
        <p className="font-display text-4xl leading-tight">
          {name} finished 🎮 Video Games{(u.round ?? 1) > 1 ? ` (set ${u.round})` : ''}
          {when ? ` ${when}` : ''}!
        </p>
        <p className="text-3xl font-extrabold text-ember-deep">
          Approve <GameIcon /> {u.stars}?
        </p>
        <div className="flex w-full gap-3 [&>*]:flex-1">
          <button
            type="button"
            onClick={() => setSnoozed((s) => ({ ...s, [keyOf(u)]: Date.now() + SNOOZE_MS }))}
            className="pressable min-h-16 rounded-2xl bg-paper-deep text-2xl font-extrabold text-ink-soft"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={approve.isPending}
            onClick={() => (locked ? setAskPin(true) : doApprove())}
            className="pressable min-h-16 rounded-2xl bg-ember text-2xl font-extrabold text-white shadow-card disabled:opacity-60"
          >
            Approve
          </button>
        </div>
      </div>
      <PinDialog
        open={askPin}
        title="Parent PIN to approve"
        error={pinError}
        onClose={() => {
          setAskPin(false)
          setPinError(null)
        }}
        onSubmit={(pin) =>
          authMutations.verifyPin.mutate(
            { pin },
            {
              onSuccess: (res) => {
                if (!res.valid) return setPinError('Wrong PIN — try again')
                setPinError(null)
                setAskPin(false)
                doApprove()
              }
            }
          )
        }
      />
    </div>
  )
}
