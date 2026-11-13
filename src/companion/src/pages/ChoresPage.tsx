import { useState, type ReactNode } from 'react'
import { DateTime } from 'luxon'
import type { ChecklistDto, ChoreDto, ChoreMode, Currency, DayChoreDto, PersonDto, RewardDto, RewardKind } from '@shared/types'
import { REWARD_ICONS } from '@shared/rewardIcons'
import {
  useAdjustStars,
  useBalances,
  useChecklistMutations,
  useChecklists,
  useChecklistsDay,
  useChoreMutations,
  useChores,
  useChoresDay,
  usePendingUnlocks,
  useShopRequestMutations,
  useShopRequests,
  useVideoGamesStars,
  useGameTimeLog,
  usePeople,
  useRewardMutations,
  useRewards,
  useToday
} from '../api/hooks'
import { Card, CheckCircle, CoinIcon, CurrencyIcon, EmptyNote, StarIcon, GhostButton, PersonAvatar, PrimaryButton, TextInput, textOn } from '../components/ui'
import { sortDayChores } from '@shared/choreOrder'
import { anchorOnSave, defaultAssignees, scheduleOf, toRecurrence, type ScheduleKind } from '@shared/choreSchedule'
import { describeRecurrence } from '@shared/recurrence/build'
import { canAddMore, claimSummary, countLabel, countOf, isCounted } from '@shared/choreCount'
import { setProgressLabel } from '@shared/setProgress'
import { useBackHandler } from '../lib/backButton'
import { dayLabel } from '@shared/dayLabel'

/** Per-person "N today · stars N" card below the chores: hidden for now (the Stars card covers it). */
const SHOW_FAMILY_SUMMARY = false

const STEP_BUTTON =
  'pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper-deep text-2xl font-extrabold text-ink-soft disabled:opacity-30'

/** A − amount + row: one star (or coin) a tap. */
function AmountStepper({
  currency,
  value,
  who,
  onStep
}: {
  currency: Currency
  /** null: the "All" row, which shows "each" */
  value: number | null
  who: string
  onStep: (delta: 1 | -1) => void
}) {
  const word = currency === 'coins' ? 'coins' : 'stars'
  return (
    <div className="flex shrink-0 items-center gap-2" data-stepper={currency}>
      <button type="button" aria-label={`Fewer ${word} for ${who}`} onClick={() => onStep(-1)} className={STEP_BUTTON}>
        −
      </button>
      {value === null ? (
        <span className="min-w-14 text-center text-sm font-extrabold text-ink-faint">
          <CurrencyIcon currency={currency} /> each
        </span>
      ) : (
        <span className={`min-w-14 text-center text-lg font-extrabold tabular-nums ${currency === 'coins' ? 'text-ink' : 'text-ember-deep'}`}>
          <CurrencyIcon currency={currency} /> {value}
        </span>
      )}
      <button type="button" aria-label={`More ${word} for ${who}`} onClick={() => onStep(1)} className={STEP_BUTTON}>
        +
      </button>
    </div>
  )
}

/**
 * Each child's stars and coins, one compact row per kid ("Emma ⭐ 44 · 🪙 6 ›"). Tapping a row opens
 * that kid's − / + steppers (one a tap) and a way to type new totals; with two or more kids, an
 * "All" row does the same for everyone at once. History is the whole log.
 */
function StarsCard({
  people,
  balanceOf,
  coinsOf
}: {
  people: PersonDto[]
  balanceOf: (id: string) => number
  coinsOf: (id: string) => number
}) {
  const kids = people.filter((p) => p.role === 'child')
  const shown = kids.length > 0 ? kids : people
  // whose steppers are open: a person, or 'all'
  const [open, setOpen] = useState<PersonDto | 'all' | null>(null)
  const [history, setHistory] = useState(false)
  if (shown.length === 0) return null
  const row = 'pressable flex w-full items-center gap-2.5 border-b border-line/60 py-2 text-left last:border-0'
  return (
    <>
      <Card>
        <div className="mb-1 flex items-center gap-2">
          <h2 className="flex-1 font-display text-xl font-semibold">Stars &amp; Coins</h2>
          <button
            type="button"
            onClick={() => setHistory(true)}
            className="pressable rounded-full border-2 border-line px-3 py-1 text-sm font-extrabold text-ink-soft"
          >
            History
          </button>
        </div>
        {shown.map((p) => (
          <button key={p.id} type="button" onClick={() => setOpen(p)} className={row} data-balance-row aria-label={`${p.name}: change stars and coins`}>
            <PersonAvatar name={p.name} color={p.color} />
            <span className="min-w-0 flex-1 truncate text-base font-bold">{p.name}</span>
            <span className="shrink-0 text-base font-extrabold tabular-nums text-ember-deep">
              <StarIcon /> {balanceOf(p.id)}
            </span>
            <span className="shrink-0 text-base font-extrabold tabular-nums text-ink">
              <CoinIcon /> {coinsOf(p.id)}
            </span>
            <span className="shrink-0 pl-1 text-xl font-bold text-ink-faint">›</span>
          </button>
        ))}
        {shown.length > 1 && (
          <button type="button" onClick={() => setOpen('all')} className={row} data-balance-row="all">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-deep text-xs font-extrabold text-ink-soft">
              All
            </span>
            <span className="min-w-0 flex-1 truncate text-base font-bold text-ink-soft">Everyone at once</span>
            <span className="shrink-0 pl-1 text-xl font-bold text-ink-faint">›</span>
          </button>
        )}
      </Card>
      {open && (
        <BalanceSheet
          who={open}
          people={shown}
          balanceOf={balanceOf}
          coinsOf={coinsOf}
          onClose={() => setOpen(null)}
        />
      )}
      {history && <GameTimeLogSheet people={people} onClose={() => setHistory(false)} />}
    </>
  )
}

/** One kid's (or everyone's) − / + for stars and coins; "Type a new total" for a big change. */
function BalanceSheet({
  who,
  people,
  balanceOf,
  coinsOf,
  onClose
}: {
  who: PersonDto | 'all'
  people: PersonDto[]
  balanceOf: (id: string) => number
  coinsOf: (id: string) => number
  onClose: () => void
}) {
  const adjust = useAdjustStars()
  const [typing, setTyping] = useState(false)
  if (who !== 'all' && typing) {
    return <EditStarsSheet person={who} stars={balanceOf(who.id)} coins={coinsOf(who.id)} onClose={onClose} />
  }
  const step = (currency: Currency, delta: 1 | -1): void => {
    const targets = who === 'all' ? people : [who]
    targets.forEach((p) => adjust.mutate({ personId: p.id, delta, ...(currency === 'coins' ? { currency } : {}) }))
  }
  const name = who === 'all' ? 'everyone' : who.name
  return (
    <Sheet onClose={onClose}>
      <div data-balance-sheet={who === 'all' ? 'all' : who.id}>
      <div className="mb-4 flex items-center gap-2.5">
        {who === 'all' ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-deep text-xs font-extrabold text-ink-soft">
            All
          </span>
        ) : (
          <PersonAvatar name={who.name} color={who.color} />
        )}
        <h2 className="flex-1 truncate font-display text-xl font-semibold">
          {who === 'all' ? 'Everyone' : who.name}: stars &amp; coins
        </h2>
      </div>
      <div className="mb-4 flex flex-col gap-3">
        {(['stars', 'coins'] as const).map((currency) => (
          <div key={currency} className="flex items-center gap-2">
            <span className="flex-1 text-base font-bold text-ink-soft">{currency === 'coins' ? 'Coins' : 'Stars'}</span>
            <AmountStepper
              currency={currency}
              value={who === 'all' ? null : currency === 'coins' ? coinsOf(who.id) : balanceOf(who.id)}
              who={name}
              onStep={(delta) => step(currency, delta)}
            />
          </div>
        ))}
      </div>
      {adjust.error && <p className="mb-3 text-sm font-bold text-ember-deep">{adjust.error.message}</p>}
      <div className="flex gap-2 [&>*]:flex-1">
        {who !== 'all' && <GhostButton onClick={() => setTyping(true)}>Type a new total</GhostButton>}
        <PrimaryButton onClick={onClose}>Done</PrimaryButton>
      </div>
      </div>
    </Sheet>
  )
}

const LOG_PAGE = 20

/** Every game time gain, loss and use (newest first), with each kid's balance after — the kiosk's log, on the phone. */
function GameTimeLogSheet({ people, onClose }: { people: PersonDto[]; onClose: () => void }) {
  const [personId, setPersonId] = useState<string | null>(null)
  const [limit, setLimit] = useState(LOG_PAGE)
  const { data: entries = [] } = useGameTimeLog(personId, limit)
  const kids = people.filter((p) => p.role === 'child')
  const byId = new Map(people.map((p) => [p.id, p]))
  return (
    <Sheet onClose={onClose}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 font-display text-xl font-semibold">Stars &amp; coins history</h2>
        <GhostButton onClick={onClose}>Close</GhostButton>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {[{ id: null as string | null, name: 'Everyone' }, ...kids].map((p) => (
          <button
            key={p.id ?? 'all'}
            type="button"
            aria-pressed={personId === p.id}
            onClick={() => {
              setPersonId(p.id)
              setLimit(LOG_PAGE)
            }}
            className={`pressable rounded-full px-3.5 py-1.5 text-sm font-extrabold ${
              personId === p.id ? 'bg-ink text-paper' : 'bg-paper-deep text-ink-soft'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <EmptyNote>Nothing yet — stars and coins earned, spent or changed show up here.</EmptyNote>
      ) : (
        <div className="flex flex-col divide-y divide-line/60">
          {entries.map((e) => {
            const p = byId.get(e.personId)
            const t = DateTime.fromISO(e.at)
            return (
              <div key={e.id} className="flex items-start gap-2.5 py-2.5" data-log-entry>
                {p && <PersonAvatar name={p.name} color={p.color} size="sm" />}
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold break-words">{e.note}</div>
                  <div className="text-xs font-bold text-ink-faint">
                    {t.toFormat('ccc LLL d')} · {t.toFormat('h:mm a').toLowerCase()}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-base font-extrabold tabular-nums ${e.delta > 0 ? 'text-[#2F8A3E]' : 'text-ember-deep'}`}>
                    {e.delta > 0 ? '+' : '−'}
                    {Math.abs(e.delta)}
                  </div>
                  <div className="text-xs font-bold text-ink-faint tabular-nums">
                    → <CurrencyIcon currency={e.currency} /> {e.balanceAfter}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {entries.length === limit && (
        <div className="mt-3">
          <GhostButton onClick={() => setLimit(limit + LOG_PAGE * 2)}>Show more</GhostButton>
        </div>
      )}
    </Sheet>
  )
}

/** A bottom sheet over a dimmed page; tapping outside it closes it. */
function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  // Android back closes the sheet (not the app)
  useBackHandler(true, onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-card p-5"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * "Who did it?" for a chore anyone can do: one big button per family member. A chore done
 * more than once a day stays open to count — each tap adds one; "Undo last" (or, for an
 * Everyone chore, a person's −) takes one back.
 */
function ClaimSheet({
  chore,
  people,
  onPick,
  onUndo,
  onClose
}: {
  chore: DayChoreDto
  people: PersonDto[]
  onPick: (personId: string) => void
  onUndo: (personId?: string) => void
  onClose: () => void
}) {
  const counted = isCounted(chore)
  const each = chore.mode !== 'anyone'
  const candidates = each ? people.filter((p) => chore.assignees.includes(p.id)) : people
  const nameOf = (id: string): string | undefined => people.find((p) => p.id === id)?.name
  const last = chore.claims.at(-1)
  return (
    <Sheet onClose={onClose}>
      <h2 className="truncate font-display text-xl font-semibold">{chore.title}</h2>
      <p className="mb-3 text-sm font-extrabold text-ink-faint">
        Who did it?
        {chore.starsValue > 0 && (
          <>
            {' · '}
            <StarIcon /> {chore.starsValue}
          </>
        )}
        {chore.coinsValue > 0 && (
          <>
            {' · '}
            <CoinIcon /> {chore.coinsValue}
          </>
        )}
        {counted && !each && ` · today ${countLabel(chore)}`}
        {counted && !each && chore.claims.length > 0 && ` · ${claimSummary(chore.claims, nameOf)}`}
      </p>
      <div className="mb-3 flex flex-col gap-2">
        {candidates.map((p) => {
          const full = counted && !canAddMore(chore, each ? p.id : undefined)
          return (
            <div key={p.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPick(p.id)}
                disabled={full}
                className="pressable flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl bg-paper-deep px-3 text-left text-lg font-extrabold disabled:opacity-40"
              >
                <PersonAvatar name={p.name} color={p.color} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {counted && each && <span className="shrink-0 text-base text-ink-soft">{countLabel(chore, p.id)}</span>}
              </button>
              {counted && each && (
                <button
                  type="button"
                  aria-label={`One less for ${p.name}`}
                  onClick={() => onUndo(p.id)}
                  disabled={countOf(chore, p.id) === 0}
                  className={STEP_BUTTON}
                >
                  −
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex gap-2 [&>*]:flex-1">
        {counted && !each && last && <GhostButton onClick={() => onUndo()}>Undo last ({nameOf(last) ?? 'Someone'})</GhostButton>}
        {counted ? <PrimaryButton onClick={onClose}>Done</PrimaryButton> : <GhostButton onClick={onClose}>Cancel</GhostButton>}
      </div>
    </Sheet>
  )
}

/** Set a child's stars or coins: − / + or type the new total; saved as one manual adjustment. */
function EditStarsSheet({ person, stars, coins, onClose }: { person: PersonDto; stars: number; coins: number; onClose: () => void }) {
  const [currency, setCurrency] = useState<Currency>('stars')
  return (
    <EditAmount key={currency} person={person} currency={currency} onCurrency={setCurrency} current={currency === 'coins' ? coins : stars} onClose={onClose} />
  )
}

function EditAmount({
  person,
  currency,
  onCurrency,
  current,
  onClose
}: {
  person: PersonDto
  currency: Currency
  onCurrency: (c: Currency) => void
  current: number
  onClose: () => void
}) {
  const adjust = useAdjustStars()
  const [text, setText] = useState(String(current))
  // a whole number, negatives too ("−" from a phone keyboard counts as a minus)
  const typed = text.trim().replace('−', '-')
  const target = /^-?\d+$/.test(typed) ? Number(typed) : null
  const set = (n: number) => setText(String(n))
  const save = () => {
    if (target === null) return
    adjust.mutate({ personId: person.id, delta: target - current, currency }, { onSuccess: onClose })
  }
  return (
    <Sheet onClose={onClose}>
      <div className="mb-4 flex items-center gap-2.5">
        <PersonAvatar name={person.name} color={person.color} />
        <h2 className="flex-1 truncate font-display text-xl font-semibold">
          {person.name}'s {currency === 'coins' ? 'coins' : 'stars'}
        </h2>
        <span className="text-sm font-extrabold text-ink-faint">
          now <CurrencyIcon currency={currency} /> {current}
        </span>
      </div>
      <div className="mb-4">
        <Segmented
          value={currency}
          onChange={onCurrency}
          options={[
            { value: 'stars', label: '⭐ Stars' },
            { value: 'coins', label: '🪙 Coins' }
          ]}
        />
      </div>
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          aria-label="One less"
          onClick={() => set((target ?? current) - 1)}
          className="pressable h-14 w-14 shrink-0 rounded-full bg-paper-deep text-3xl font-extrabold text-ink-soft"
        >
          −
        </button>
        <TextInput value={text} onChange={setText} inputMode="numeric" />
        <button
          type="button"
          aria-label="One more"
          onClick={() => set((target ?? current) + 1)}
          className="pressable h-14 w-14 shrink-0 rounded-full bg-paper-deep text-3xl font-extrabold text-ink-soft"
        >
          +
        </button>
      </div>
      {adjust.error && <p className="mb-3 text-sm font-bold text-ember-deep">{adjust.error.message}</p>}
      <div className="flex gap-2 [&>*]:flex-1">
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <PrimaryButton onClick={save} disabled={target === null || target === current || adjust.isPending}>
          Save
        </PrimaryButton>
      </div>
    </Sheet>
  )
}

/**
 * An "everyone" chore: one button per person; a tap ticks or un-ticks just them. One done more
 * than once a day shows each person's count, and a tap opens the counting sheet (`onCount`).
 */
function EachChoreRow({
  chore,
  people,
  date,
  onCount
}: {
  chore: DayChoreDto
  people: PersonDto[]
  date: string
  onCount?: () => void
}) {
  const mutations = useChoreMutations()
  const counted = isCounted(chore)
  return (
    <div className="border-b border-line/60 py-2 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`min-w-0 flex-1 truncate text-base font-semibold ${chore.completed ? 'text-ink-faint line-through' : ''}`}>
          {chore.title}
        </span>
        {chore.starsValue > 0 && <span className="shrink-0 text-sm font-extrabold text-ink-faint"><StarIcon /> {chore.starsValue}</span>}
        {chore.coinsValue > 0 && <span className="shrink-0 text-sm font-extrabold text-ink-faint"><CoinIcon /> {chore.coinsValue}</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {chore.assignees.map((id) => {
          const p = people.find((x) => x.id === id)
          if (!p) return null
          const done = chore.doneBy.includes(id)
          return (
            <button
              key={id}
              type="button"
              aria-pressed={done}
              onClick={() =>
                counted && onCount
                  ? onCount()
                  : done
                    ? mutations.uncomplete.mutate({ choreId: chore.choreId, date, personId: id })
                    : mutations.complete.mutate({ choreId: chore.choreId, date, personId: id })
              }
              className={`pressable flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-sm font-extrabold ${
                done ? 'text-white' : 'bg-paper-deep text-ink-soft'
              }`}
              style={done ? { backgroundColor: p.color } : undefined}
            >
              <PersonAvatar name={p.name} color={p.color} size="sm" />
              {done ? '✓ ' : ''}
              {p.name}
              {counted && <span className="opacity-80">{countLabel(chore, id)}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const UNLOCK_TEXT = { pending: 'waiting for a parent', approved: 'unlocked!' } as const

export function ChoresPage() {
  const today = useToday()
  const { data: dayChores = [], isPending } = useChoresDay(today)
  const { data: checklists = [] } = useChecklistsDay(today)
  const { data: people = [] } = usePeople()
  const { data: balances = [] } = useBalances()
  const mutations = useChoreMutations()
  const [showManage, setShowManage] = useState(false)
  // ⚙ Manage (rewards, new chore, the chore list): closed until a parent opens it
  const [setupOpen, setSetupOpen] = useState(false)
  const [editingChore, setEditingChore] = useState<ChoreDto | 'new' | null>(null)
  // the chore whose "who did it?" picker is open — as it is now, so a counting sheet shows each tick
  const [claimingId, setClaimingId] = useState<string | null>(null)
  // Video Games tasks and checklist items live in their set's card, not the plain chore list
  const claiming =
    dayChores.find((c) => c.choreId === claimingId) ??
    checklists.flatMap((cl) => cl.items).find((c) => c.choreId === claimingId) ??
    null
  const nameOf = (id: string): string | undefined => people.find((p) => p.id === id)?.name

  const balanceOf = (personId: string): number => balances.find((b) => b.personId === personId)?.balance ?? 0
  const coinsOf = (personId: string): number => balances.find((b) => b.personId === personId)?.coins ?? 0
  const done = dayChores.filter((c) => c.completed).length

  return (
    <div className="flex flex-col gap-4">
      {/* what's waiting for a parent first (sign-offs, Shop requests: only when there are some), then the kids'
          balances, the checklists and today's other chores; setup lives in ⚙ Manage at the bottom */}
      <PendingUnlocksCard people={people} today={today} />

      <StarsCard people={people} balanceOf={balanceOf} coinsOf={coinsOf} />

      {isPending && <EmptyNote>Loading…</EmptyNote>}
      {!isPending && dayChores.length === 0 && checklists.length === 0 && <EmptyNote>No chores today.</EmptyNote>}

      {checklists.map((cl) => (
        <Card key={cl.checklistId}>
          <h2 className="font-display text-xl font-semibold">
            ⭐ {cl.title}
            {cl.kind === 'videogames' && (
              <span className="ml-2 text-lg text-ember-deep">
                <StarIcon /> {cl.stars}
              </span>
            )}
          </h2>
          <div className="mb-1 text-sm font-extrabold text-ink-faint">
            {cl.people
              .map((s) => {
                const name = people.find((p) => p.id === s.personId)?.name ?? '?'
                return `${name} ${setProgressLabel(cl, s, UNLOCK_TEXT)}`
              })
              .join(' · ')}
          </div>
          {cl.items.map((item) => (
            <EachChoreRow key={item.choreId} chore={item} people={people} date={today} />
          ))}
        </Card>
      ))}

      {dayChores.length > 0 && (
        <Card>
          <div className="mb-1 flex items-center gap-2.5">
            <h2 className="flex-1 truncate font-display text-xl font-semibold">Today</h2>
            <span className="text-sm font-extrabold text-ink-faint">
              {done}/{dayChores.length} done
            </span>
          </div>
          {sortDayChores(dayChores).map((chore) => {
            if (chore.mode !== 'anyone') {
              return (
                <EachChoreRow
                  key={chore.choreId}
                  chore={chore}
                  people={people}
                  date={today}
                  onCount={() => setClaimingId(chore.choreId)}
                />
              )
            }
            const counted = isCounted(chore)
            // the latest doer's colour (the only one, for a plain chore)
            const claimer = people.find((p) => p.id === (counted ? chore.claims.at(-1) : chore.completedBy))
            // a plain chore: done → a tap un-ticks it; to do → asks who did it. A counted one always asks.
            const tap = () => {
              if (!counted && chore.completed) mutations.uncomplete.mutate({ choreId: chore.choreId, date: today })
              else setClaimingId(chore.choreId)
            }
            return (
              <div key={chore.choreId} className="border-b border-line/60 last:border-0">
                <div className="flex items-center">
                  <CheckCircle
                    checked={chore.completed}
                    color={claimer?.color ?? '#999'}
                    onTap={tap}
                    label={`${chore.completed ? 'Uncheck' : 'Check off'} ${chore.title}`}
                  />
                  <span className="min-w-0 flex-1 cursor-pointer py-2" onClick={tap}>
                    <span
                      className={`block truncate text-base font-semibold ${chore.completed ? 'text-ink-faint line-through' : ''}`}
                    >
                      {chore.title}
                    </span>
                    {counted
                      ? chore.claims.length > 0 && (
                          <span className="block truncate text-xs font-extrabold text-ink-faint">
                            {claimSummary(chore.claims, nameOf)}
                          </span>
                        )
                      : claimer && <span className="block truncate text-xs font-extrabold text-ink-faint">{claimer.name}</span>}
                  </span>
                  {counted && (
                    <span className="mr-2 shrink-0 rounded-full bg-paper-deep px-2 py-0.5 text-sm font-extrabold text-ink-soft">
                      {countLabel(chore)}
                    </span>
                  )}
                  {chore.starsValue > 0 && (
                    <span className="shrink-0 text-sm font-extrabold text-ink-faint"><StarIcon /> {chore.starsValue}</span>
                  )}
                  {chore.coinsValue > 0 && (
                    <span className="ml-1.5 shrink-0 text-sm font-extrabold text-ink-faint"><CoinIcon /> {chore.coinsValue}</span>
                  )}
                </div>
              </div>
            )
          })}
        </Card>
      )}

      {claiming && (
        <ClaimSheet
          chore={claiming}
          people={people}
          onClose={() => setClaimingId(null)}
          onPick={(personId) => {
            // a counting sheet stays open for the next one
            if (!isCounted(claiming)) setClaimingId(null)
            mutations.complete.mutate({ choreId: claiming.choreId, date: today, personId })
          }}
          onUndo={(personId) =>
            mutations.uncomplete.mutate({ choreId: claiming.choreId, date: today, ...(personId ? { personId } : {}) })
          }
        />
      )}

      {SHOW_FAMILY_SUMMARY && people.length > 0 && (
        <Card>
          {people.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 py-1">
              <PersonAvatar name={p.name} color={p.color} />
              <span className="min-w-0 flex-1 truncate text-base font-bold">{p.name}</span>
              <span className="text-sm font-extrabold text-ink-faint">
                {dayChores.filter((c) => c.completedBy === p.id).length} today · <StarIcon /> {balanceOf(p.id)}
              </span>
            </div>
          ))}
        </Card>
      )}

      {/* setup, used weekly by parents (never by kids): folded away at the bottom */}
      <section className="flex flex-col gap-4" data-manage-section={setupOpen ? 'open' : 'closed'}>
        <button
          type="button"
          onClick={() => setSetupOpen((v) => !v)}
          aria-expanded={setupOpen}
          className="pressable flex min-h-12 items-center gap-2 rounded-2xl border-2 border-line px-4 text-left text-base font-extrabold text-ink-soft"
        >
          <span className="flex-1">⚙ Manage rewards, chores &amp; checklists</span>
          <span className={`text-xl transition-transform ${setupOpen ? 'rotate-90' : ''}`}>›</span>
        </button>
        {setupOpen && (
          <>
            <RewardsCard />
            <GhostButton onClick={() => setEditingChore('new')}>+ New chore</GhostButton>
            <GhostButton onClick={() => setShowManage((v) => !v)}>
              {showManage ? 'Hide chores & checklists' : 'Manage chores & checklists'}
            </GhostButton>
            {showManage && <ManageChores people={people} onEditChore={setEditingChore} />}
          </>
        )}
      </section>

      {editingChore && <ChoreSheet chore={editingChore} people={people} onClose={() => setEditingChore(null)} />}
    </div>
  )
}

const WEEKDAY_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** A row of mutually exclusive choices. */
function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex overflow-hidden rounded-xl bg-paper-deep">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-11 flex-1 px-2 text-sm font-extrabold ${value === o.value ? 'bg-card shadow-card' : 'text-ink-soft'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-sm font-extrabold text-ink-soft">{children}</div>
}

/** "Repeats": every day / chosen weekdays / one time. */
function ScheduleField({
  schedule,
  weekdays,
  onSchedule,
  onWeekdays
}: {
  schedule: ScheduleKind
  weekdays: number[]
  onSchedule: (s: ScheduleKind) => void
  onWeekdays: (d: number[]) => void
}) {
  return (
    <div>
      <FieldLabel>Repeats</FieldLabel>
      <Segmented
        value={schedule}
        onChange={onSchedule}
        options={[
          { value: 'daily', label: 'Every day' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'once', label: 'One time' }
        ]}
      />
      {schedule === 'weekly' && (
        <div className="mt-2 flex justify-between">
          {WEEKDAY_SHORT.map((label, i) => {
            const on = weekdays.includes(i)
            return (
              <button
                key={i}
                type="button"
                aria-pressed={on}
                aria-label={WEEKDAY_NAMES[i]}
                onClick={() => onWeekdays(on ? weekdays.filter((d) => d !== i) : [...weekdays, i])}
                className={`pressable flex h-10 w-10 items-center justify-center rounded-full text-base font-extrabold ${
                  on ? 'bg-ember text-white' : 'bg-paper-deep text-ink-soft'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Toggle family members in or out. */
function PeoplePicker({
  people,
  selected,
  onChange
}: {
  people: PersonDto[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {people.map((p) => {
        const on = selected.includes(p.id)
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((id) => id !== p.id) : [...selected, p.id])}
            className={`pressable flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-sm font-extrabold ${
              on ? '' : 'bg-paper-deep text-ink-soft'
            }`}
            style={on ? { backgroundColor: p.color, color: textOn(p.color) } : undefined}
          >
            <PersonAvatar name={p.name} color={p.color} size="sm" />
            {p.name}
          </button>
        )
      })}
    </div>
  )
}

/** Delete needs a second tap, so a stray thumb can't lose a chore. */
function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [armed, setArmed] = useState(false)
  return (
    <button
      type="button"
      onClick={() => (armed ? onDelete() : setArmed(true))}
      className={`pressable min-h-11 rounded-xl px-4 text-base font-extrabold ${
        armed ? 'bg-ember-deep text-white' : 'bg-paper-deep text-ember-deep'
      }`}
    >
      {armed ? 'Tap again to delete' : 'Delete'}
    </button>
  )
}

/** Add or edit a chore: the same fields as the kiosk's chore editor. */
function ChoreSheet({ chore, people, onClose }: { chore: ChoreDto | 'new'; people: PersonDto[]; onClose: () => void }) {
  const mutations = useChoreMutations()
  const isNew = chore === 'new'
  const today = DateTime.now()
  // rrule weekdays: 0 = Monday; luxon: 1 = Monday. A new weekly chore starts on today's.
  const todayWeekday = today.weekday - 1
  const [title, setTitle] = useState(isNew ? '' : chore.title)
  const [stars, setStars] = useState(isNew ? 1 : chore.starsValue)
  const [coins, setCoins] = useState(isNew ? 0 : chore.coinsValue)
  const [mode, setMode] = useState<ChoreMode>(isNew ? 'anyone' : chore.mode)
  const [assignees, setAssignees] = useState<string[]>(
    !isNew && chore.mode !== 'anyone' ? chore.assignees : defaultAssignees(people)
  )
  const [schedule, setSchedule] = useState<ScheduleKind>(isNew ? 'daily' : scheduleOf(chore.recurrence))
  const [weekdays, setWeekdays] = useState<number[]>(isNew ? [todayWeekday] : (chore.recurrence?.byWeekdays ?? [todayWeekday]))
  const [routine, setRoutine] = useState<'any' | 'morning' | 'evening'>(isNew ? 'any' : (chore.routine ?? 'any'))
  const [times, setTimes] = useState(isNew ? 1 : (chore.times ?? 1))
  const [noLimit, setNoLimit] = useState(!isNew && chore.times === null)
  const valid = title.trim() !== '' && (mode === 'anyone' || assignees.length > 0)
  const busy = mutations.create.isPending || mutations.update.isPending || mutations.remove.isPending
  const error = mutations.create.error ?? mutations.update.error ?? mutations.remove.error

  const save = (): void => {
    if (!valid) return
    const common = {
      title: title.trim(),
      starsValue: stars,
      coinsValue: coins,
      recurrence: toRecurrence(schedule, weekdays),
      routine: routine === 'any' ? null : routine,
      mode,
      ...(mode !== 'anyone' ? { assignees } : {}),
      // only weekly and one-time chores can be done more than once on their day
      times: schedule === 'daily' ? 1 : noLimit ? null : times
    }
    if (isNew) {
      mutations.create.mutate({ ...common, anchorDate: today.toISODate()! }, { onSuccess: onClose })
    } else {
      const anchorDate = anchorOnSave(chore.recurrence, schedule, today.toISODate()!)
      mutations.update.mutate({ id: chore.id, ...common, ...(anchorDate ? { anchorDate } : {}) }, { onSuccess: onClose })
    }
  }

  return (
    <Sheet onClose={onClose}>
      <h2 className="mb-3 font-display text-xl font-semibold">{isNew ? 'New chore' : 'Edit chore'}</h2>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <TextInput value={title} onChange={setTitle} placeholder="Chore (e.g. Feed the dog)" autoFocus={isNew} />
        <div>
          <FieldLabel>Who does it</FieldLabel>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              // "Everyone" is no longer offered for new chores; an existing one keeps it so it isn't changed by accident
              { value: 'anyone', label: 'Whoever' },
              ...(!isNew && chore.mode === 'each' ? [{ value: 'each' as const, label: 'Everyone' }] : []),
              { value: 'videogames', label: '⭐ Video Games' }
            ]}
          />
          {mode !== 'anyone' && (
            <div className="mt-2">
              <PeoplePicker people={people} selected={assignees} onChange={setAssignees} />
            </div>
          )}
        </div>
        {mode === 'videogames' && <VideoGamesNote />}
        <div className="flex flex-wrap items-end gap-4">
          <div className={mode === 'videogames' ? 'hidden' : ''} data-chore-coins>
            <FieldLabel>Coins</FieldLabel>
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label="Fewer coins" onClick={() => setCoins((n) => Math.max(0, n - 1))} className={STEP_BUTTON}>
                −
              </button>
              <span className="min-w-11 text-center text-base font-extrabold tabular-nums">
                <CoinIcon /> {coins}
              </span>
              <button type="button" aria-label="More coins" onClick={() => setCoins((n) => Math.min(20, n + 1))} className={STEP_BUTTON}>
                +
              </button>
            </div>
          </div>
          <div className={`order-first ${mode === 'videogames' ? 'hidden' : ''}`}>
            <FieldLabel>Stars</FieldLabel>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Fewer stars"
                onClick={() => setStars((n) => Math.max(0, n - 1))}
                className={STEP_BUTTON}
              >
                −
              </button>
              <span className="min-w-11 text-center text-base font-extrabold tabular-nums"><StarIcon /> {stars}</span>
              <button
                type="button"
                aria-label="More stars"
                onClick={() => setStars((n) => Math.min(20, n + 1))}
                className={STEP_BUTTON}
              >
                +
              </button>
            </div>
          </div>
          <div className="min-w-0 basis-full">
            <FieldLabel>Time of day</FieldLabel>
            <Segmented
              value={routine}
              onChange={setRoutine}
              options={[
                { value: 'any', label: 'Any' },
                { value: 'morning', label: 'Morning' },
                { value: 'evening', label: 'Evening' }
              ]}
            />
          </div>
        </div>
        <ScheduleField schedule={schedule} weekdays={weekdays} onSchedule={setSchedule} onWeekdays={setWeekdays} />
        {schedule !== 'daily' && (
          <div>
            <FieldLabel>{mode !== 'anyone' ? 'Times that day, each' : 'Times that day'}</FieldLabel>
            <div className="flex items-center gap-3">
              {!noLimit && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Fewer times"
                    onClick={() => setTimes((n) => Math.max(1, n - 1))}
                    className={STEP_BUTTON}
                  >
                    −
                  </button>
                  <span className="min-w-11 text-center text-base font-extrabold tabular-nums" data-times>
                    {times}×
                  </span>
                  <button
                    type="button"
                    aria-label="More times"
                    onClick={() => setTimes((n) => Math.min(10, n + 1))}
                    className={STEP_BUTTON}
                  >
                    +
                  </button>
                </div>
              )}
              <button
                type="button"
                aria-pressed={noLimit}
                onClick={() => setNoLimit(!noLimit)}
                className={`pressable min-h-10 rounded-full px-4 text-sm font-extrabold ${
                  noLimit ? 'bg-ember text-white' : 'bg-paper-deep text-ink-soft'
                }`}
              >
                No limit
              </button>
            </div>
          </div>
        )}
        {error && <p className="text-sm font-bold text-ember-deep">{error.message}</p>}
        <div className="flex gap-2 [&>*]:flex-1">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={!valid || busy}>
            {isNew ? 'Add chore' : 'Save'}
          </PrimaryButton>
        </div>
        {!isNew && (
          <div className="flex gap-2 [&>*]:flex-1">
            <GhostButton onClick={() => mutations.update.mutate({ id: chore.id, active: !chore.active }, { onSuccess: onClose })}>
              {chore.active ? 'Pause' : 'Resume'}
            </GhostButton>
            <DeleteButton onDelete={() => mutations.remove.mutate({ id: chore.id }, { onSuccess: onClose })} />
          </div>
        )}
      </form>
    </Sheet>
  )
}

/** Add or edit a checklist: what it unlocks, who, the items, and when it repeats. */
function ChecklistSheet({
  checklist,
  people,
  onClose
}: {
  checklist: ChecklistDto | 'new'
  people: PersonDto[]
  onClose: () => void
}) {
  const mutations = useChecklistMutations()
  const isNew = checklist === 'new'
  const [title, setTitle] = useState(isNew ? '' : checklist.title)
  const [assignees, setAssignees] = useState<string[]>(isNew ? defaultAssignees(people) : checklist.assignees)
  // a new checklist defaults to weekends
  const [schedule, setSchedule] = useState<ScheduleKind>(isNew ? 'weekly' : scheduleOf(checklist.recurrence))
  const [weekdays, setWeekdays] = useState<number[]>(isNew ? [5, 6] : (checklist.recurrence?.byWeekdays ?? []))
  const [items, setItems] = useState<{ id?: string; title: string }[]>(
    isNew ? [{ title: '' }, { title: '' }, { title: '' }] : checklist.items
  )
  const filled = items.map((i) => ({ ...i, title: i.title.trim() })).filter((i) => i.title)
  const valid = title.trim() !== '' && assignees.length > 0 && filled.length > 0
  const busy = mutations.create.isPending || mutations.update.isPending || mutations.remove.isPending
  const error = mutations.create.error ?? mutations.update.error ?? mutations.remove.error
  const today = DateTime.now().toISODate()!

  const save = (): void => {
    if (!valid) return
    const input = { title: title.trim(), assignees, recurrence: toRecurrence(schedule, weekdays), items: filled }
    if (isNew) mutations.create.mutate({ ...input, anchorDate: today }, { onSuccess: onClose })
    else {
      const anchorDate = anchorOnSave(checklist.recurrence, schedule, today)
      mutations.update.mutate({ id: checklist.id, ...input, ...(anchorDate ? { anchorDate } : {}) }, { onSuccess: onClose })
    }
  }

  return (
    <Sheet onClose={onClose}>
      <h2 className="mb-3 font-display text-xl font-semibold">{isNew ? 'New checklist' : 'Edit checklist'}</h2>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <div>
          <FieldLabel>Unlocks</FieldLabel>
          <TextInput value={title} onChange={setTitle} placeholder="e.g. Video game time" autoFocus={isNew} />
        </div>
        <div>
          <FieldLabel>Who</FieldLabel>
          <PeoplePicker people={people} selected={assignees} onChange={setAssignees} />
        </div>
        <div>
          <FieldLabel>To do</FieldLabel>
          <div className="flex flex-col gap-2">
            {items.map((item, i) => (
              <div key={item.id ?? `new-${i}`} className="flex items-center gap-2">
                <TextInput
                  value={item.title}
                  onChange={(v) => setItems(items.map((it, j) => (j === i ? { ...it, title: v } : it)))}
                  placeholder={['e.g. Go outside', 'e.g. Read for 15 minutes', 'e.g. Something artistic'][i] ?? 'Another item'}
                />
                <button
                  type="button"
                  aria-label="Remove item"
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                  className="pressable h-11 w-11 shrink-0 rounded-xl bg-paper-deep text-lg font-extrabold text-ink-soft"
                >
                  ×
                </button>
              </div>
            ))}
            {items.length < 20 && <GhostButton onClick={() => setItems([...items, { title: '' }])}>+ Add item</GhostButton>}
          </div>
        </div>
        <ScheduleField schedule={schedule} weekdays={weekdays} onSchedule={setSchedule} onWeekdays={setWeekdays} />
        {error && <p className="text-sm font-bold text-ember-deep">{error.message}</p>}
        <div className="flex gap-2 [&>*]:flex-1">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={!valid || busy}>
            {isNew ? 'Add checklist' : 'Save'}
          </PrimaryButton>
        </div>
        {!isNew && (
          <div className="flex [&>*]:flex-1">
            <DeleteButton onDelete={() => mutations.remove.mutate({ id: checklist.id }, { onSuccess: onClose })} />
          </div>
        )}
      </form>
    </Sheet>
  )
}

/**
 * Waiting for a parent: finished checklists and Video Games sets to sign off today, and Shop
 * purchases to OK (nothing is spent until then; a timed reward's timer starts on OK).
 */
export function PendingUnlocksCard({ people, today }: { people: PersonDto[]; today: string }) {
  const { data: pending = [] } = usePendingUnlocks(today)
  const { data: requests = [] } = useShopRequests()
  const mutations = useChecklistMutations()
  const shop = useShopRequestMutations()
  const [error, setError] = useState<string | null>(null)
  if (pending.length === 0 && requests.length === 0) return null
  const nameOf = (id: string): string => people.find((p) => p.id === id)?.name ?? 'Someone'
  const onError = (e: Error): void => setError(e.message)
  return (
    <div className="rounded-card bg-sun-soft p-4 shadow-card">
      <h2 className="mb-1 font-display text-xl font-semibold">Waiting for you</h2>
      {requests.map((r) => (
        <div key={r.id} className="flex items-center gap-2 border-b border-line/60 py-2 last:border-0" data-shop-request>
          <span className="min-w-0 flex-1 text-base font-bold">
            🛒 {nameOf(r.personId)} wants {r.rewardTitle}
            <span className="ml-1.5 text-ember-deep">
              · <CurrencyIcon currency={r.currency} /> {r.starsSpent}
            </span>
            {r.minutes !== null && <span className="text-ink-faint"> · {r.minutes} min</span>}
          </span>
          <GhostButton onClick={() => shop.deny.mutate({ redemptionId: r.id }, { onError })}>No</GhostButton>
          <PrimaryButton onClick={() => shop.grant.mutate({ redemptionId: r.id }, { onError, onSuccess: () => setError(null) })}>OK</PrimaryButton>
        </div>
      ))}
      {pending.map((u) => (
        <div
          key={`${u.checklistId}:${u.personId}:${u.round ?? 0}`}
          className="flex items-center gap-2.5 border-b border-line/60 py-2 last:border-0"
        >
          <span className="min-w-0 flex-1 text-base font-bold">
            {nameOf(u.personId)} finished ⭐ {u.title}
            {u.kind === 'videogames' && (u.round ?? 1) > 1 ? ` (set ${u.round})` : ''}
            {dayLabel(u.date, today) ? ` · ${dayLabel(u.date, today)}` : ''}
            {u.kind === 'videogames' && (
              <span className="ml-1.5 text-ember-deep">
                · <StarIcon /> {u.stars}
              </span>
            )}
          </span>
          <PrimaryButton
            onClick={() =>
              mutations.approve.mutate({ checklistId: u.checklistId, personId: u.personId, date: u.date, round: u.round })
            }
          >
            Approve
          </PrimaryButton>
        </div>
      ))}
      {error && <p className="mt-2 text-sm font-bold text-ember-deep">{error}</p>}
    </div>
  )
}

/** Shown instead of the stars field: Video Games chores pay only as a whole set. */
function VideoGamesNote() {
  const { data } = useVideoGamesStars()
  return (
    <p className="rounded-xl bg-sun-soft px-3 py-2 text-sm font-bold text-ink-soft">
      Pays nothing alone: finishing all of the day's ⭐ Video Games chores earns <StarIcon /> {data?.stars ?? '…'} (again for
      each full set), once a parent approves.
    </p>
  )
}

/** Every chore (paused ones dimmed) and checklist; tap one to edit it. */
function ManageChores({ people, onEditChore }: { people: PersonDto[]; onEditChore: (c: ChoreDto) => void }) {
  const { data: chores = [] } = useChores()
  const { data: checklists = [] } = useChecklists()
  const [editingChecklist, setEditingChecklist] = useState<ChecklistDto | 'new' | null>(null)
  const names = (ids: string[]): string =>
    ids
      .map((id) => people.find((p) => p.id === id)?.name)
      .filter(Boolean)
      .join(', ')
  const repeats = (r: ChoreDto['recurrence']): string => (r ? describeRecurrence(r) : 'One time')
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <h2 className="mb-1 font-display text-xl font-semibold">Chores</h2>
        {chores.length === 0 && <EmptyNote>No chores yet.</EmptyNote>}
        {[...chores]
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onEditChore(c)}
              className={`pressable flex w-full items-center gap-2.5 border-b border-line/60 py-2 text-left last:border-0 ${
                c.active ? '' : 'opacity-50'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-bold">{c.title}</span>
                <span className="block truncate text-xs font-extrabold text-ink-faint">
                  {c.active ? '' : 'Paused · '}
                  {c.mode === 'each' ? `Everyone: ${names(c.assignees)} · ` : c.mode === 'videogames' ? `⭐ Video Games: ${names(c.assignees)} · ` : ''}
                  {repeats(c.recurrence)}
                  {c.times === null ? ' · no limit' : c.times > 1 ? ` · ${c.times}×` : ''}
                  {c.routine ? ` · ${c.routine}` : ''}
                </span>
              </span>
              {c.starsValue > 0 && <span className="shrink-0 text-sm font-extrabold text-ink-faint"><StarIcon /> {c.starsValue}</span>}
              {c.coinsValue > 0 && <span className="shrink-0 text-sm font-extrabold text-ink-faint"><CoinIcon /> {c.coinsValue}</span>}
            </button>
          ))}
      </Card>
      <Card>
        <h2 className="mb-1 font-display text-xl font-semibold">Checklists</h2>
        {checklists.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setEditingChecklist(c)}
            className="pressable flex w-full flex-col border-b border-line/60 py-2 text-left last:border-0"
          >
            <span className="truncate text-base font-bold">⭐ {c.title}</span>
            <span className="truncate text-xs font-extrabold text-ink-faint">{c.items.map((i) => i.title).join(' · ')}</span>
            <span className="truncate text-xs font-extrabold text-ink-faint">
              {names(c.assignees)} · {repeats(c.recurrence)}
            </span>
          </button>
        ))}
        <p className="py-2 text-xs font-semibold text-ink-faint">
          Each person does every item; once they've ticked them all, a parent approves it and it's unlocked for the day.
        </p>
        <GhostButton onClick={() => setEditingChecklist('new')}>+ New checklist</GhostButton>
      </Card>
      {editingChecklist && (
        <ChecklistSheet checklist={editingChecklist} people={people} onClose={() => setEditingChecklist(null)} />
      )}
    </div>
  )
}

/** The Shop's rewards, as in the kiosk's Settings → Chores → Rewards: tap one to edit it, or add one. */
function RewardsCard() {
  const { data: rewards = [] } = useRewards()
  const [editing, setEditing] = useState<RewardDto | 'new' | null>(null)
  return (
    <Card>
      <h2 className="mb-1 font-display text-xl font-semibold" data-rewards-card>
        Rewards
      </h2>
      <p className="mb-2 text-sm font-bold text-ink-faint">What the kids can spend their stars or coins on in the tablet's Shop.</p>
      {rewards.length === 0 && <EmptyNote>No rewards yet</EmptyNote>}
      {rewards.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => setEditing(r)}
          className="pressable flex w-full items-center gap-3 border-b border-line/60 py-2.5 text-left last:border-0"
          data-reward-row
        >
          <span className="w-8 shrink-0 text-center text-2xl">{r.icon ?? '⭐'}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-bold">{r.title}</span>
            <span className="block text-sm font-bold text-ink-faint">
              {r.kind === 'dynamic'
                ? `Kid picks the stars, 1 a minute${r.bonusMinutes > 0 ? ` · +${r.bonusMinutes} min bonus` : ''}`
                : 'A parent hands it over'}
            </span>
          </span>
          {r.kind === 'static' && (
            <span className="shrink-0 text-base font-extrabold text-ember-deep">
              <CurrencyIcon currency={r.currency} /> {r.costStars}
            </span>
          )}
        </button>
      ))}
      <div className="mt-2 flex [&>*]:flex-1">
        <GhostButton onClick={() => setEditing('new')}>+ New reward</GhostButton>
      </div>
      {editing && <RewardSheet reward={editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

/** A number with − / + buttons (and typing), kept between min and max. */
function NumberStepper({
  value,
  onChange,
  min,
  max,
  label
}: {
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  label: string
}) {
  const clamp = (n: number): number => Math.min(max, Math.max(min, Math.round(n)))
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label={`Less ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - 1))} className={STEP_BUTTON}>
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(clamp(Number(e.target.value) || min))}
        aria-label={label}
        className="h-10 w-20 rounded-xl border-2 border-line bg-paper text-center text-base font-extrabold tabular-nums outline-none focus:border-ember"
      />
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(clamp(value + 1))} className={STEP_BUTTON}>
        +
      </button>
    </div>
  )
}

/** Add or edit a reward: the same fields as the kiosk's reward editor. */
function RewardSheet({ reward, onClose }: { reward: RewardDto | 'new'; onClose: () => void }) {
  const isNew = reward === 'new'
  const mutations = useRewardMutations()
  const [title, setTitle] = useState(isNew ? '' : reward.title)
  const [kind, setKind] = useState<RewardKind>(isNew ? 'static' : reward.kind)
  const [cost, setCost] = useState(isNew || reward.kind === 'dynamic' ? 10 : reward.costStars)
  const [bonus, setBonus] = useState(isNew ? 0 : reward.bonusMinutes)
  const [icon, setIcon] = useState<string | null>(isNew ? null : reward.icon)
  const [currency, setCurrency] = useState<Currency>(isNew ? 'stars' : reward.currency)
  const busy = mutations.create.isPending || mutations.update.isPending
  const error = mutations.create.error ?? mutations.update.error ?? mutations.remove.error
  const valid = title.trim() !== ''
  const save = (): void => {
    if (!valid) return
    const input = {
      title: title.trim(),
      kind,
      costStars: kind === 'static' ? cost : 1,
      bonusMinutes: kind === 'dynamic' ? bonus : 0,
      icon,
      // timers run on stars; only a set price can be in coins
      currency: kind === 'static' ? currency : ('stars' as const)
    }
    if (isNew) mutations.create.mutate(input, { onSuccess: onClose })
    else mutations.update.mutate({ id: reward.id, ...input }, { onSuccess: onClose })
  }
  return (
    <Sheet onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        data-reward-sheet
      >
        <h2 className="font-display text-xl font-semibold">{isNew ? 'New reward' : 'Edit reward'}</h2>
        <div>
          <FieldLabel>Reward</FieldLabel>
          <TextInput value={title} onChange={setTitle} placeholder="e.g. Movie night pick" autoFocus={isNew} />
        </div>
        <div>
          <FieldLabel>Type</FieldLabel>
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: 'static', label: 'Static' },
              { value: 'dynamic', label: 'Dynamic' }
            ]}
          />
          <p className="mt-1.5 text-sm font-bold text-ink-faint">
            {kind === 'static'
              ? 'A set price (a pack of gum for 5 stars). A parent hands it over on the tablet.'
              : 'The kid picks how many stars to spend, 1 a minute, and a timer runs (like Video Game Time).'}
          </p>
        </div>
        {kind === 'static' ? (
          <>
            <div>
              <FieldLabel>Paid with</FieldLabel>
              <Segmented
                value={currency}
                onChange={setCurrency}
                options={[
                  { value: 'stars', label: '⭐ Stars' },
                  { value: 'coins', label: '🪙 Coins' }
                ]}
              />
            </div>
            <div>
              <FieldLabel>{currency === 'coins' ? 'Cost in coins' : 'Cost in stars'}</FieldLabel>
              <NumberStepper value={cost} onChange={setCost} min={1} max={999} label={currency} />
            </div>
          </>
        ) : (
          <div>
            <FieldLabel>Bonus time (minutes)</FieldLabel>
            <NumberStepper value={bonus} onChange={setBonus} min={0} max={240} label="bonus minutes" />
            <p className="mt-1.5 text-sm font-bold text-ink-faint">Added to every timer — e.g. 3 minutes to get the console going.</p>
          </div>
        )}
        <div>
          <FieldLabel>Icon</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {REWARD_ICONS.map((e) => (
              <button
                key={e ?? 'none'}
                type="button"
                aria-pressed={icon === e}
                onClick={() => setIcon(e)}
                className={`pressable h-11 w-11 rounded-full text-2xl ${icon === e ? 'bg-ember-soft ring-2 ring-ember' : 'bg-paper-deep'}`}
              >
                {e ?? '⭐'}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-sm font-bold text-ember-deep">{error.message}</p>}
        <div className="flex gap-2 [&>*]:flex-1">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={!valid || busy}>
            {isNew ? 'Add reward' : 'Save'}
          </PrimaryButton>
        </div>
        {!isNew && (
          <div className="flex gap-2 [&>*]:flex-1">
            <DeleteButton onDelete={() => mutations.remove.mutate({ id: reward.id }, { onSuccess: onClose })} />
          </div>
        )}
      </form>
    </Sheet>
  )
}
