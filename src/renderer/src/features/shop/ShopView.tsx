import { useState } from 'react'
import { useBalances, usePeople } from '../../api/hooks'
import { ControllerIcon } from '../../components/icons'
import { GameTimeBadge } from '../shell/Header'
import { UseTimeDialog } from '../shell/UseTimeDialog'

/**
 * The tablet's Shop screen (top switcher: Home · Week · Month · Chat · Shop · Lists): things the
 * kids can spend their stars on. One item for now — Video Game Time, a badge per kid that opens the
 * same "use your time?" pop-up as their header badge (same spending, same waiting-for-approval case).
 */
export function ShopView() {
  const { data: people = [] } = usePeople()
  const { data: balances = [] } = useBalances()
  const kids = people.filter((p) => p.role === 'child')
  const [usingTime, setUsingTime] = useState<string | null>(null)
  const balance = (id: string | null): number => balances.find((b) => b.personId === id)?.balance ?? 0
  return (
    <div className="h-full overflow-y-auto px-5 pb-4" data-shop-view>
      <h2 className="mb-3 px-1 font-display text-3xl font-semibold text-ink" data-shop-title>
        💵 Kid's Shop 💵
      </h2>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-5 rounded-3xl bg-card px-7 py-5 shadow-card" data-shop-item="videogames">
          <ControllerIcon className="shrink-0 text-4xl text-ember-deep" />
          <span className="min-w-0 flex-1 font-display text-3xl">Video Game Time</span>
          {kids.length === 0 ? (
            <span className="text-lg font-bold text-ink-faint">Add the kids in Settings → Family</span>
          ) : (
            <div className="flex shrink-0 items-start gap-5">
              {kids.map((p) => (
                <div key={p.id} className="flex flex-col items-center gap-1.5">
                  <GameTimeBadge person={p} stars={balance(p.id)} onClick={() => setUsingTime(p.id)} />
                  <span className="max-w-24 truncate text-sm font-extrabold text-ink-soft">{p.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <UseTimeDialog person={kids.find((k) => k.id === usingTime) ?? null} balance={balance(usingTime)} onClose={() => setUsingTime(null)} />
    </div>
  )
}
