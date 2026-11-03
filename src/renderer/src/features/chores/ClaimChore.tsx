import { useState, type ReactNode } from 'react'
import type { DayChoreDto, PersonDto } from '@shared/types'
import { canAddMore, claimSummary, countLabel, countOf, isCounted } from '@shared/choreCount'
import { useChoreMutations, useChoresDay, usePeople } from '../../api/hooks'
import { useToasts } from '../../stores/toastStore'
import { initials, textOn } from '../../lib/format'
import { CheckIcon } from '../../components/icons'
import { BigButton, Dialog } from '../../components/ui'

export function Avatar({ person, size = 'h-12 w-12 text-base' }: { person: PersonDto; size?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-extrabold ${size}`}
      style={{ backgroundColor: person.color, color: textOn(person.color) }}
    >
      {initials(person.name)}
    </span>
  )
}

/**
 * "Who did it?" — an 'anyone' chore lists the family and the pick claims it; an 'each'
 * chore lists just its people, ticked when done, and a tap ticks or un-ticks that person.
 * A chore done more than once a day stays open: each tap adds one, with today's count,
 * and "Undo last" (or a person's −) takes one back.
 */
function ClaimDialog({
  chore,
  people,
  onPick,
  onUndo,
  onClose
}: {
  chore: DayChoreDto | null
  people: PersonDto[]
  onPick: (person: PersonDto) => void
  onUndo: (personId?: string) => void
  onClose: () => void
}) {
  const each = chore?.mode === 'each'
  const counted = chore ? isCounted(chore) : false
  const candidates = each ? people.filter((p) => chore.assignees.includes(p.id)) : people
  const nameOf = (id: string): string | undefined => people.find((p) => p.id === id)?.name
  const last = chore?.claims.at(-1)
  return (
    <Dialog open={chore !== null} onClose={onClose} title="Who did it?">
      <div className="mb-4">
        <div className="truncate text-lg font-bold text-ink-soft">
          {chore?.title}
          {chore && chore.starsValue > 0 && <span className="ml-2 text-ember-deep">★ {chore.starsValue}</span>}
        </div>
        {chore && counted && !each && (
          <div className="text-base font-bold text-ink-faint" data-count>
            Today {countLabel(chore)}
            {chore.claims.length > 0 && ` · ${claimSummary(chore.claims, nameOf)}`}
            {!canAddMore(chore) && ' · all done'}
          </div>
        )}
      </div>
      {candidates.length === 0 ? (
        <p className="text-base font-semibold text-ink-soft">Add family members in Settings first.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {candidates.map((p) => {
            if (chore && counted && each) {
              const full = !canAddMore(chore, p.id)
              return (
                <div key={p.id} className="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onPick(p)}
                    disabled={full}
                    className="pressable flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-paper-deep/50 p-2.5 text-left disabled:opacity-100"
                    style={full ? { boxShadow: `inset 0 0 0 3px ${p.color}` } : undefined}
                  >
                    <Avatar person={p} size="h-11 w-11 text-sm" />
                    <span className="min-w-0 flex-1 truncate text-lg font-bold">{p.name}</span>
                    <span className="shrink-0 text-base font-extrabold text-ink-soft">{countLabel(chore, p.id)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`One less for ${p.name}`}
                    onClick={() => onUndo(p.id)}
                    disabled={countOf(chore, p.id) === 0}
                    className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-paper-deep text-2xl font-bold disabled:opacity-30"
                  >
                    −
                  </button>
                </div>
              )
            }
            const done = each && chore.doneBy.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p)}
                disabled={counted && chore !== null && !canAddMore(chore)}
                aria-pressed={each ? done : undefined}
                className="pressable flex min-w-0 items-center gap-3 rounded-2xl bg-paper-deep/50 p-2.5 text-left disabled:opacity-40"
                style={done ? { boxShadow: `inset 0 0 0 3px ${p.color}` } : undefined}
              >
                <Avatar person={p} size="h-11 w-11 text-sm" />
                <span className="min-w-0 flex-1 truncate text-lg font-bold">{p.name}</span>
                {done && <CheckIcon size={22} style={{ color: p.color }} />}
              </button>
            )
          })}
        </div>
      )}
      {each && !counted && <p className="mt-3 text-sm font-semibold text-ink-faint">Tap a name to tick it — tap again to undo.</p>}
      {each && counted && <p className="mt-3 text-sm font-semibold text-ink-faint">Tap a name each time they do it.</p>}
      <div className="mt-4 flex justify-end gap-3">
        {counted && !each && last && (
          <BigButton variant="ghost" onClick={() => onUndo()}>
            Undo last ({nameOf(last) ?? 'Someone'})
          </BigButton>
        )}
        <BigButton variant={counted ? 'primary' : 'ghost'} onClick={onClose}>
          {counted ? 'Done' : 'Cancel'}
        </BigButton>
      </div>
    </Dialog>
  )
}

/**
 * Tapping a chore anywhere. 'anyone': an open one asks "Who did it?" and credits the pick;
 * a done one is un-ticked (its stars go back). 'each': asks whose tick to toggle.
 * A chore done more than once a day always opens the picker, which stays open to count.
 * `toggle` flips one person's tick on an 'each' chore directly. Render `dialog` once.
 */
export function useChoreClaim(date: string): {
  tap: (chore: DayChoreDto) => void
  toggle: (chore: DayChoreDto, person: PersonDto) => void
  dialog: ReactNode
} {
  const { data: people = [] } = usePeople()
  const { data: dayChores = [] } = useChoresDay(date)
  const mutations = useChoreMutations()
  const pushToast = useToasts((s) => s.push)
  const [claiming, setClaiming] = useState<DayChoreDto | null>(null)
  // the open chore as it is now, so a counting picker shows each new tick
  const current = claiming ? (dayChores.find((c) => c.choreId === claiming.choreId) ?? claiming) : null

  const complete = (chore: DayChoreDto, person: PersonDto): void => {
    mutations.complete.mutate(
      { choreId: chore.choreId, date, personId: person.id },
      {
        onSuccess: (res) => {
          if (res.unlocked) pushToast(`🎮 ${person.name} finished ${res.unlocked}! Ask a parent to sign off.`)
          else if (chore.starsValue > 0) pushToast(`★ ${chore.starsValue} for ${person.name}!`)
          else if (chore.mode === 'anyone') pushToast(`Thanks, ${person.name}!`)
        }
      }
    )
  }

  const toggle = (chore: DayChoreDto, person: PersonDto): void => {
    if (isCounted(chore)) setClaiming(chore)
    else if (chore.doneBy.includes(person.id)) {
      mutations.uncomplete.mutate({ choreId: chore.choreId, date, personId: person.id })
    } else complete(chore, person)
  }

  const pick = (person: PersonDto): void => {
    const chore = current
    if (!chore) return
    if (isCounted(chore)) {
      complete(chore, person)
      return
    }
    setClaiming(null)
    if (chore.mode === 'each') toggle(chore, person)
    else complete(chore, person)
  }

  const undo = (personId?: string): void => {
    if (current) mutations.uncomplete.mutate({ choreId: current.choreId, date, ...(personId ? { personId } : {}) })
  }

  const tap = (chore: DayChoreDto): void => {
    if (isCounted(chore)) setClaiming(chore)
    else if (chore.mode === 'anyone' && chore.completed) mutations.uncomplete.mutate({ choreId: chore.choreId, date })
    else setClaiming(chore)
  }

  return {
    tap,
    toggle,
    dialog: <ClaimDialog chore={current} people={people} onPick={pick} onUndo={undo} onClose={() => setClaiming(null)} />
  }
}
