import { useState } from 'react'
import { DateTime } from 'luxon'
import { useGameTimeLog, usePeople } from '../../api/hooks'
import { FieldLabel } from '../../components/ui'
import { StarIcon } from '../../components/icons'
import { initials, textOn } from '../../lib/format'
import { ZONE } from '../../stores/uiStore'

const PAGE = 20

/**
 * Every game time gain, loss and use, newest first, with each kid's balance right after — for
 * settling "I did so do it!" arguments. Filter to one kid; "Show more" goes further back.
 */
export function GameTimeLog() {
  const { data: people = [] } = usePeople()
  const [personId, setPersonId] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const { data: entries = [] } = useGameTimeLog(personId, limit)
  const byId = new Map(people.map((p) => [p.id, p]))
  const kids = people.filter((p) => p.role === 'child')

  const pick = (id: string | null): void => {
    setPersonId(id)
    setLimit(PAGE)
  }

  return (
    <div>
      <FieldLabel>🎮 Game time log</FieldLabel>
      <div className="flex flex-col gap-3 rounded-2xl bg-paper-deep/50 p-4">
        <div className="flex flex-wrap gap-2">
          {[{ id: null, name: 'Everyone' }, ...kids].map((p) => (
            <button
              key={p.id ?? 'all'}
              type="button"
              aria-pressed={personId === p.id}
              onClick={() => pick(p.id)}
              className={`pressable rounded-full px-4 py-1.5 text-sm font-extrabold ${
                personId === p.id ? 'bg-ink text-paper' : 'bg-card text-ink-soft'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>

        {entries.length === 0 ? (
          <p className="text-sm font-semibold text-ink-faint">Nothing yet — game time earned, spent or changed shows up here.</p>
        ) : (
          <div className="flex flex-col divide-y divide-line/60">
            {entries.map((e) => {
              const p = byId.get(e.personId)
              const t = DateTime.fromISO(e.at).setZone(ZONE)
              return (
                <div key={e.id} className="flex items-center gap-3 py-2" data-log-entry>
                  <span className="w-28 shrink-0 text-xs leading-tight font-bold text-ink-faint">
                    {t.toFormat('ccc LLL d')}
                    <br />
                    {t.toFormat('h:mm a').toLowerCase()}
                  </span>
                  {p && (
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold"
                      style={{ backgroundColor: p.color, color: textOn(p.color) }}
                      title={p.name}
                    >
                      {initials(p.name)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 text-base font-bold break-words text-ink">{e.note}</span>
                  <span
                    className={`w-16 shrink-0 text-right text-base font-extrabold tabular-nums ${
                      e.delta > 0 ? 'text-[#2F8A3E]' : 'text-ember-deep'
                    }`}
                  >
                    {e.delta > 0 ? '+' : '−'}
                    {Math.abs(e.delta)}
                  </span>
                  <span className="w-20 shrink-0 text-right text-sm font-bold text-ink-faint tabular-nums">
                    → <StarIcon /> {e.balanceAfter}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {entries.length === limit && (
          <button
            type="button"
            onClick={() => setLimit(limit + PAGE * 2)}
            className="pressable self-start rounded-full border-2 border-line px-4 py-1.5 text-sm font-bold text-ink-soft"
          >
            Show more
          </button>
        )}
      </div>
    </div>
  )
}
