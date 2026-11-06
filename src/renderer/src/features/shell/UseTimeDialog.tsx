import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { VIDEO_GAME_REWARD_ID, type PersonDto, type RewardDto } from '@shared/types'
import { usePendingUnlocks, useUseTime } from '../../api/hooks'
import { BigButton, Dialog } from '../../components/ui'
import { StarIcon } from '../../components/icons'
import { useToasts } from '../../stores/toastStore'
import { useApprovals } from '../../stores/approvalStore'
import { ZONE } from '../../stores/uiStore'
import { gameMinutes, minutesLabel } from '@shared/gameTime'

/**
 * Tapped from a kid's badge on a dynamic Shop reward (Video Game Time, TV time…): spend some or all
 * of their stars on it. It starts at all of them; − / + pick how many (1 up to their balance), and
 * the minutes follow — 1 a star plus the reward's bonus. For Video Game Time, a kid with a finished
 * Video Games set still waiting for a parent gets that request instead (even if they'd tapped "Not
 * now" on it), so they can bring it back themselves.
 */
export function UseTimeDialog({
  person,
  balance,
  reward,
  onClose
}: {
  person: PersonDto | null
  balance: number
  reward: RewardDto | null
  onClose: () => void
}) {
  const reopen = useApprovals((s) => s.reopen)
  const { data: pending = [] } = usePendingUnlocks(DateTime.now().setZone(ZONE).toISODate()!)
  const waiting =
    !!person && reward?.id === VIDEO_GAME_REWARD_ID && pending.some((u) => u.kind === 'videogames' && u.personId === person.id)
  useEffect(() => {
    if (!person || !waiting) return
    reopen(person.id)
    onClose()
  }, [person, waiting, reopen, onClose])
  if (!person || !reward || waiting) return null
  // keyed by person and reward, so it starts again at their full balance each time it opens
  return <UseTimeBody key={`${person.id}:${reward.id}`} person={person} balance={balance} reward={reward} onClose={onClose} />
}

/** A round − / + beside the star count. */
const STEP = 'pressable flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-paper-deep text-4xl font-extrabold text-ink disabled:opacity-30'

function UseTimeBody({ person, balance, reward, onClose }: { person: PersonDto; balance: number; reward: RewardDto; onClose: () => void }) {
  const useTime = useUseTime()
  const pushToast = useToasts((s) => s.push)
  const [stars, setStars] = useState(balance)
  // the balance can change while it's open (a chore approved): keep the pick within it
  const spend = Math.max(1, Math.min(stars, balance))
  const { play, total } = gameMinutes(spend, reward.bonusMinutes)
  return (
    <Dialog open onClose={onClose} title={`${person.name} · ${reward.title}`}>
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
              {reward.bonusMinutes > 0
                ? `That's ${minutesLabel(total)} (${minutesLabel(play)} + ${reward.bonusMinutes} bonus)`
                : `That's ${minutesLabel(total)}`}
            </p>
            <div className="flex w-full gap-3 [&>*]:flex-1">
              <BigButton variant="ghost" onClick={onClose}>
                No
              </BigButton>
              <BigButton
                disabled={useTime.isPending}
                onClick={() =>
                  useTime.mutate(
                    { personId: person.id, stars: spend, rewardId: reward.id },
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
