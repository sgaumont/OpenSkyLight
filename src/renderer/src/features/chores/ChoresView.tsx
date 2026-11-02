import { useState } from 'react'
import { DateTime } from 'luxon'
import type { DayChoreDto, PersonDto } from '@shared/types'
import { useBalances, useChoreMutations, useChoresDay, usePeople } from '../../api/hooks'
import { useUi, ZONE } from '../../stores/uiStore'
import { useToasts } from '../../stores/toastStore'
import { initials, isToday, textOn } from '../../lib/format'
import { CheckIcon, MoonIcon, SunIcon } from '../../components/icons'
import { BigButton, Dialog } from '../../components/ui'
import { RewardsDialog } from './RewardsDialog'

function StarBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sun-soft px-2.5 py-1 text-sm font-extrabold text-ember-deep">
      <span aria-hidden>★</span>
      {count}
    </span>
  )
}

function Avatar({ person, size = 'h-12 w-12 text-base' }: { person: PersonDto; size?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-extrabold ${size}`}
      style={{ backgroundColor: person.color, color: textOn(person.color) }}
    >
      {initials(person.name)}
    </span>
  )
}

/** A chore belongs to no one: an open circle until someone claims it, then their colour and name. */
function ChoreRow({
  chore,
  claimer,
  canCheck,
  onClaim,
  onUnclaim
}: {
  chore: DayChoreDto
  claimer: PersonDto | undefined
  canCheck: boolean
  onClaim: () => void
  onUnclaim: () => void
}) {
  return (
    <button
      type="button"
      onClick={chore.completed ? onUnclaim : onClaim}
      disabled={!canCheck}
      className={`pressable flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left shadow-card disabled:opacity-60 ${
        chore.completed ? 'opacity-75' : ''
      }`}
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px] transition-colors ${
          claimer ? '' : 'border-line'
        }`}
        style={claimer ? { borderColor: claimer.color, backgroundColor: claimer.color } : undefined}
      >
        {chore.completed && (
          <CheckIcon size={24} className="animate-pop" style={{ color: claimer ? textOn(claimer.color) : undefined }} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-lg font-bold ${chore.completed ? 'text-ink-faint line-through' : ''}`}>
          {chore.title}
        </span>
        {chore.completed && (
          <span className="block truncate text-sm font-bold" style={{ color: claimer?.color }}>
            {claimer ? `Done by ${claimer.name}` : 'Done'}
          </span>
        )}
      </span>
      {chore.starsValue > 0 && <StarBadge count={chore.starsValue} />}
    </button>
  )
}

/** "Who did it?" — the tapped person claims the chore and its stars. */
function ClaimDialog({
  chore,
  people,
  onPick,
  onClose
}: {
  chore: DayChoreDto | null
  people: PersonDto[]
  onPick: (person: PersonDto) => void
  onClose: () => void
}) {
  return (
    <Dialog open={chore !== null} onClose={onClose} title="Who did it?">
      <div className="mb-4 truncate text-lg font-bold text-ink-soft">
        {chore?.title}
        {chore && chore.starsValue > 0 && <span className="ml-2 text-ember-deep">★ {chore.starsValue}</span>}
      </div>
      {people.length === 0 ? (
        <p className="text-base font-semibold text-ink-soft">Add family members in Settings first.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {people.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p)}
              className="pressable flex min-w-0 items-center gap-3 rounded-2xl bg-paper-deep/50 p-2.5 text-left"
            >
              <Avatar person={p} size="h-11 w-11 text-sm" />
              <span className="min-w-0 flex-1 truncate text-lg font-bold">{p.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <BigButton variant="ghost" onClick={onClose}>
          Cancel
        </BigButton>
      </div>
    </Dialog>
  )
}

function FamilyPanel({ people, chores }: { people: PersonDto[]; chores: DayChoreDto[] }) {
  const { data: balances = [] } = useBalances()
  return (
    <div className="flex min-h-0 w-80 shrink-0 flex-col gap-2 overflow-y-auto rounded-card bg-paper-deep/40 p-3">
      {people.map((p) => {
        const done = chores.filter((c) => c.completedBy === p.id).length
        return (
          <div key={p.id} className="flex items-center gap-3 rounded-2xl p-1">
            <Avatar person={p} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xl font-bold">{p.name}</div>
              <div className="text-sm font-bold text-ink-faint">{done === 0 ? 'Nothing yet' : `${done} done`}</div>
            </div>
            <StarBadge count={balances.find((b) => b.personId === p.id)?.balance ?? 0} />
          </div>
        )
      })}
    </div>
  )
}

export function ChoresView() {
  const focusedDate = useUi((s) => s.focusedDate)
  const hiddenPeople = useUi((s) => s.hiddenPeople)
  const setSettingsOpen = useUi((s) => s.setSettingsOpen)
  const { data: people = [] } = usePeople()
  const { data: chores = [] } = useChoresDay(focusedDate)
  const mutations = useChoreMutations()
  const pushToast = useToasts((s) => s.push)
  const [rewardsOpen, setRewardsOpen] = useState(false)
  const [claiming, setClaiming] = useState<DayChoreDto | null>(null)
  const day = DateTime.fromISO(focusedDate, { zone: ZONE })
  // checking off chores for other days is allowed only for today and the past
  const canCheck = focusedDate <= DateTime.now().setZone(ZONE).toISODate()!
  const peopleById = new Map(people.map((p) => [p.id, p]))
  const visiblePeople = people.filter((p) => !hiddenPeople.includes(p.id))

  const groups: { key: string; label: string | null; Icon: typeof SunIcon | null; items: DayChoreDto[] }[] = [
    { key: 'morning', label: 'Morning', Icon: SunIcon, items: chores.filter((c) => c.routine === 'morning') },
    { key: 'anytime', label: null, Icon: null, items: chores.filter((c) => c.routine === null) },
    { key: 'evening', label: 'Evening', Icon: MoonIcon, items: chores.filter((c) => c.routine === 'evening') }
  ].filter((g) => g.items.length > 0)
  const doneCount = chores.filter((c) => c.completed).length

  const claim = (person: PersonDto): void => {
    const chore = claiming
    setClaiming(null)
    if (!chore) return
    mutations.complete.mutate(
      { choreId: chore.choreId, date: focusedDate, personId: person.id },
      {
        onSuccess: () =>
          pushToast(chore.starsValue > 0 ? `★ ${chore.starsValue} for ${person.name}!` : `Thanks, ${person.name}!`)
      }
    )
  }

  return (
    <div className="flex h-full flex-col px-6 pb-6">
      <div className="animate-rise mb-4 flex items-end gap-4">
        <div className="flex-1">
          <div className="font-display text-4xl">
            {isToday(focusedDate) ? "Today's chores" : `Chores · ${day.toFormat('cccc, LLL d')}`}
          </div>
          {chores.length > 0 && (
            <div className="text-base font-bold text-ink-faint">
              {doneCount}/{chores.length} done · tap a chore when it's finished to claim it
            </div>
          )}
        </div>
        <BigButton variant="ghost" onClick={() => setRewardsOpen(true)}>
          ★ Rewards
        </BigButton>
      </div>

      {chores.length === 0 ? (
        <div className="animate-rise mt-16 flex flex-col items-center gap-4 text-center">
          <div className="font-display text-3xl text-ink-faint">No chores for this day</div>
          <p className="max-w-md text-base font-semibold text-ink-soft">
            Parents can set up routines and chores in Settings → Chores.
          </p>
          <BigButton variant="ghost" onClick={() => setSettingsOpen(true)}>
            Open settings
          </BigButton>
        </div>
      ) : (
        <div className="animate-rise flex min-h-0 flex-1 gap-4">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
            {groups.map((g) => (
              <div key={g.key} className="flex flex-col gap-2">
                {g.label && (
                  <div className="mt-1 flex items-center gap-1.5 px-1 text-sm font-extrabold tracking-wide text-ink-faint uppercase">
                    {g.Icon && <g.Icon size={15} />}
                    {g.label}
                  </div>
                )}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-2">
                  {g.items.map((c) => (
                    <ChoreRow
                      key={c.choreId}
                      chore={c}
                      claimer={c.completedBy ? peopleById.get(c.completedBy) : undefined}
                      canCheck={canCheck}
                      onClaim={() => setClaiming(c)}
                      onUnclaim={() => mutations.uncomplete.mutate({ choreId: c.choreId, date: focusedDate })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {visiblePeople.length > 0 && <FamilyPanel people={visiblePeople} chores={chores} />}
        </div>
      )}

      <ClaimDialog chore={claiming} people={people} onPick={claim} onClose={() => setClaiming(null)} />
      <RewardsDialog open={rewardsOpen} onClose={() => setRewardsOpen(false)} />
    </div>
  )
}
