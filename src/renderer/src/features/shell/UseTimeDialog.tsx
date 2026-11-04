import { useEffect } from 'react'
import { DateTime } from 'luxon'
import type { PersonDto } from '@shared/types'
import { usePendingUnlocks, useUseTime } from '../../api/hooks'
import { BigButton, Dialog } from '../../components/ui'
import { GameIcon } from '../../components/icons'
import { useToasts } from '../../stores/toastStore'
import { useApprovals } from '../../stores/approvalStore'
import { ZONE } from '../../stores/uiStore'
import { SETUP_MINUTES, gameMinutes, minutesLabel } from '@shared/gameTime'

/**
 * Tapped from a kid's header badge: spend all their saved-up controllers on game time. A kid with a
 * finished Video Games set still waiting for a parent gets that request instead (even if they'd
 * tapped "Not now" on it), so they can bring it back themselves.
 */
export function UseTimeDialog({ person, balance, onClose }: { person: PersonDto | null; balance: number; onClose: () => void }) {
  const useTime = useUseTime()
  const pushToast = useToasts((s) => s.push)
  const reopen = useApprovals((s) => s.reopen)
  const { data: pending = [] } = usePendingUnlocks(DateTime.now().setZone(ZONE).toISODate()!)
  const waiting = !!person && pending.some((u) => u.kind === 'videogames' && u.personId === person.id)
  useEffect(() => {
    if (!person || !waiting) return
    reopen(person.id)
    onClose()
  }, [person, waiting, reopen, onClose])
  if (!person || waiting) return null
  const { play, total } = gameMinutes(balance)
  return (
    <Dialog open onClose={onClose} title={person.name}>
      <div className="flex flex-col items-center gap-5 text-center">
        <span className="text-4xl font-extrabold text-ember-deep tabular-nums">
          <GameIcon /> {balance}
        </span>
        {balance > 0 ? (
          <>
            <p className="font-display text-3xl">Do you want to use your time?</p>
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
                    { personId: person.id },
                    {
                      onSuccess: (res) => {
                        if (res.used > 0) pushToast(`🎮 Enjoy your ${minutesLabel(res.minutes)}, ${person.name}!`)
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
            <p className="font-display text-2xl">No time saved up yet — finish some chores first!</p>
            <BigButton onClick={onClose}>OK</BigButton>
          </>
        )}
      </div>
    </Dialog>
  )
}
