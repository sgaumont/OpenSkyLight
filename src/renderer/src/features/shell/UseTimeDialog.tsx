import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import type { PersonDto } from '@shared/types'
import { usePendingUnlocks, useUseTime } from '../../api/hooks'
import { BigButton, Dialog } from '../../components/ui'
import { StarIcon } from '../../components/icons'
import { useToasts } from '../../stores/toastStore'
import { useApprovals } from '../../stores/approvalStore'
import { ZONE } from '../../stores/uiStore'
import { SETUP_MINUTES, gameMinutes, minutesLabel } from '@shared/gameTime'

/**
 * Tapped from a kid's badge on the Shop: spend some or all of their stars on game time. It starts
 * at all of them; − / + pick how many (1 up to their balance), and the minutes follow. A kid with a
 * finished Video Games set still waiting for a parent gets that request instead (even if they'd
 * tapped "Not now" on it), so they can bring it back themselves.
 */
export function UseTimeDialog({ person, balance, onClose }: { person: PersonDto | null; balance: number; onClose: () => void }) {
  const reopen = useApprovals((s) => s.reopen)
  const { data: pending = [] } = usePendingUnlocks(DateTime.now().setZone(ZONE).toISODate()!)
  const waiting = !!person && pending.some((u) => u.kind === 'videogames' && u.personId === person.id)
  useEffect(() => {
    if (!person || !waiting) return
    reopen(person.id)
    onClose()
  }, [person, waiting, reopen, onClose])
  if (!person || waiting) return null
  // keyed by person, so it starts again at their full balance each time it opens
  return <UseTimeBody key={person.id} person={person} balance={balance} onClose={onClose} />
}

/** A round − / + beside the star count. */
const STEP = 'pressable flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-paper-deep text-4xl font-extrabold text-ink disabled:opacity-30'

function UseTimeBody({ person, balance, onClose }: { person: PersonDto; balance: number; onClose: () => void }) {
  const useTime = useUseTime()
  const pushToast = useToasts((s) => s.push)
  const [stars, setStars] = useState(balance)
  // the balance can change while it's open (a chore approved): keep the pick within it
  const spend = Math.max(1, Math.min(stars, balance))
  const { play, total } = gameMinutes(spend)
  return (
    <Dialog open onClose={onClose} title={person.name}>
      <div className="flex flex-col items-center gap-5 text-center">
        {balance > 0 ? (
          <>
            <p className="font-display text-3xl">Do you want to use your time?</p>
            {/* how many stars to spend: starts at all of them */}
            <div className="flex items-center gap-6" data-spend-picker>
              <button type="button" aria-label="One star less" className={STEP} disabled={spend <= 1} onClick={() => setStars(spend - 1)}>
                −
              </button>
              <span className="min-w-28 text-5xl font-extrabold text-ember-deep tabular-nums" data-spend>
                <StarIcon /> {spend}
              </span>
              <button type="button" aria-label="One star more" className={STEP} disabled={spend >= balance} onClick={() => setStars(spend + 1)}>
                +
              </button>
            </div>
            <p className="-mt-2 text-base font-bold text-ink-faint">
              {spend < balance ? `${balance - spend} left over after this` : `All ${balance} of ${person.name}'s stars`}
            </p>
            <p className="-mt-2 text-lg font-bold text-ink-soft">
              That's {minutesLabel(total)} ({minutesLabel(play)} + {SETUP_MINUTES} to set up)
            </p>
            <div className="flex w-full gap-3 [&>*]:flex-1">
              <BigButton variant="ghost" onClick={onClose}>
                No
              </BigButton>
              <BigButton
                disabled={useTime.isPending}
                onClick={() =>
                  useTime.mutate(
                    { personId: person.id, stars: spend },
                    {
                      onSuccess: (res) => {
                        if (res.used > 0) pushToast(`⭐ Enjoy your ${minutesLabel(res.minutes)}, ${person.name}!`)
                        onClose()
                      }
                    }
                  )
                }
              >
                Yes
              </BigButton>
            </div>
          </>
        ) : (
          <>
            <span className="text-4xl font-extrabold text-ember-deep tabular-nums">
              <StarIcon /> 0
            </span>
            <p className="font-display text-2xl">No time saved up yet — finish some chores first!</p>
            <BigButton onClick={onClose}>OK</BigButton>
          </>
        )}
      </div>
    </Dialog>
  )
}
