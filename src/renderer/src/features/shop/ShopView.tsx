import { useState } from 'react'
import type { PersonDto, RewardDto } from '@shared/types'
import { useBalances, usePeople, useRewardMutations, useRewards } from '../../api/hooks'
import { ControllerIcon, StarIcon } from '../../components/icons'
import { BigButton, Dialog } from '../../components/ui'
import { useToasts } from '../../stores/toastStore'
import { GameTimeBadge } from '../shell/Header'
import { UseTimeDialog } from '../shell/UseTimeDialog'

/**
 * The tablet's Shop screen (opened from a kid's star badge in the header): the rewards set up in
 * Settings → Chores, each with a badge per kid. A dynamic reward (Video Game Time) opens the
 * − N + "use your time?" pop-up and starts a timer; a static one (a pack of gum, ⭐ 5) asks to
 * spend that much, and then waits for a parent to grant it.
 */
export function ShopView() {
  const { data: people = [] } = usePeople()
  const { data: balances = [] } = useBalances()
  const { data: rewards = [] } = useRewards()
  const kids = people.filter((p) => p.role === 'child')
  const [picked, setPicked] = useState<{ personId: string; reward: RewardDto } | null>(null)
  const balance = (id: string | null | undefined): number => balances.find((b) => b.personId === id)?.balance ?? 0
  const person = kids.find((k) => k.id === picked?.personId) ?? null
  return (
    <div className="h-full overflow-y-auto px-5 pb-4" data-shop-view>
      <h2 className="mb-3 px-1 font-display text-3xl font-semibold text-ink" data-shop-title>
        💵 Kid's Shop 💵
      </h2>
      <div className="flex flex-col gap-3">
        {rewards.length === 0 && (
          <p className="rounded-3xl bg-card px-7 py-6 text-lg font-bold text-ink-faint shadow-card">
            Nothing in the shop yet — a parent can add rewards in Settings → Chores.
          </p>
        )}
        {rewards.map((r) => (
          <div key={r.id} className="flex items-center gap-5 rounded-3xl bg-card px-7 py-5 shadow-card" data-shop-item={r.id} data-shop-kind={r.kind}>
            <RewardIcon reward={r} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-3xl">{r.title}</span>
              <span className="block text-base font-bold text-ink-faint" data-shop-price>
                {r.kind === 'static' ? (
                  <span className="text-ember-deep">
                    <StarIcon /> {r.costStars}
                  </span>
                ) : (
                  <>
                    <StarIcon /> 1 a minute{r.bonusMinutes > 0 ? ` · +${r.bonusMinutes} min bonus` : ''}
                  </>
                )}
              </span>
            </span>
            {kids.length === 0 ? (
              <span className="text-lg font-bold text-ink-faint">Add the kids in Settings → Family</span>
            ) : (
              <div className="flex shrink-0 items-start gap-5">
                {kids.map((p) => (
                  <div key={p.id} className="flex flex-col items-center gap-1.5">
                    <GameTimeBadge person={p} stars={balance(p.id)} onClick={() => setPicked({ personId: p.id, reward: r })} />
                    <span className="max-w-24 truncate text-sm font-extrabold text-ink-soft">{p.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <UseTimeDialog
        person={picked?.reward.kind === 'dynamic' ? person : null}
        reward={picked?.reward ?? null}
        balance={balance(picked?.personId)}
        onClose={() => setPicked(null)}
      />
      {picked?.reward.kind === 'static' && person && (
        <BuyDialog person={person} reward={picked.reward} balance={balance(person.id)} onClose={() => setPicked(null)} />
      )}
    </div>
  )
}

/** A reward's emoji (Video Game Time's controller drawn as the app's icon), or a star. */
function RewardIcon({ reward }: { reward: RewardDto }) {
  if (reward.icon === '🎮') return <ControllerIcon className="shrink-0 text-4xl text-ember-deep" />
  if (reward.icon) return <span className="w-10 shrink-0 text-center text-4xl leading-none">{reward.icon}</span>
  return <StarIcon className="shrink-0 text-4xl text-ember-deep" />
}

/** A static reward: spend its price now; a parent grants it from Settings → Chores. */
function BuyDialog({ person, reward, balance, onClose }: { person: PersonDto; reward: RewardDto; balance: number; onClose: () => void }) {
  const { redeem } = useRewardMutations()
  const pushToast = useToasts((s) => s.push)
  const short = reward.costStars - balance
  return (
    <Dialog open onClose={onClose} title={`${person.name} · ${reward.title}`}>
      <div className="flex flex-col items-center gap-5 text-center" data-buy-dialog>
        <span className="text-5xl font-extrabold text-ember-deep tabular-nums">
          <StarIcon /> {reward.costStars}
        </span>
        {short > 0 ? (
          <>
            <p className="font-display text-2xl">
              {short} more {short === 1 ? 'star' : 'stars'} to go — you have {balance}.
            </p>
            <BigButton onClick={onClose}>OK</BigButton>
          </>
        ) : (
          <>
            <p className="font-display text-3xl">Spend {reward.costStars} {reward.costStars === 1 ? 'star' : 'stars'} on {reward.title}?</p>
            <p className="-mt-2 text-base font-bold text-ink-faint">{balance - reward.costStars} left over · a parent hands it over</p>
            <div className="flex w-full gap-3 [&>*]:flex-1">
              <BigButton variant="ghost" onClick={onClose}>
                No
              </BigButton>
              <BigButton
                disabled={redeem.isPending}
                onClick={() =>
                  redeem.mutate(
                    { rewardId: reward.id, personId: person.id },
                    {
                      onSuccess: () => {
                        pushToast(`${reward.title} for ${person.name} — ask a parent to hand it over!`)
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
        )}
      </div>
    </Dialog>
  )
}
