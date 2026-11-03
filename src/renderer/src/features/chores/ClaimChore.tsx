import { useState, type ReactNode } from 'react'
import type { DayChoreDto, PersonDto } from '@shared/types'
import { useChoreMutations, usePeople } from '../../api/hooks'
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
 */
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
  const each = chore?.mode === 'each'
  const candidates = each ? people.filter((p) => chore.assignees.includes(p.id)) : people
  return (
    <Dialog open={chore !== null} onClose={onClose} title="Who did it?">
      <div className="mb-4 truncate text-lg font-bold text-ink-soft">
        {chore?.title}
        {chore && chore.starsValue > 0 && <span className="ml-2 text-ember-deep">★ {chore.starsValue}</span>}
      </div>
      {candidates.length === 0 ? (
        <p className="text-base font-semibold text-ink-soft">Add family members in Settings first.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {candidates.map((p) => {
            const done = each && chore.doneBy.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p)}
                aria-pressed={each ? done : undefined}
                className="pressable flex min-w-0 items-center gap-3 rounded-2xl bg-paper-deep/50 p-2.5 text-left"
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
      {each && <p className="mt-3 text-sm font-semibold text-ink-faint">Tap a name to tick it — tap again to undo.</p>}
      <div className="mt-4 flex justify-end">
        <BigButton variant="ghost" onClick={onClose}>
          Cancel
        </BigButton>
      </div>
    </Dialog>
  )
}

/**
 * Tapping a chore anywhere. 'anyone': an open one asks "Who did it?" and credits the pick;
 * a done one is un-ticked (its stars go back). 'each': asks whose tick to toggle.
 * `toggle` flips one person's tick on an 'each' chore directly. Render `dialog` once.
 */
export function useChoreClaim(date: string): {
  tap: (chore: DayChoreDto) => void
  toggle: (chore: DayChoreDto, person: PersonDto) => void
  dialog: ReactNode
} {
  const { data: people = [] } = usePeople()
  const mutations = useChoreMutations()
  const pushToast = useToasts((s) => s.push)
  const [claiming, setClaiming] = useState<DayChoreDto | null>(null)

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
    if (chore.doneBy.includes(person.id)) {
      mutations.uncomplete.mutate({ choreId: chore.choreId, date, personId: person.id })
    } else complete(chore, person)
  }

  const pick = (person: PersonDto): void => {
    const chore = claiming
    setClaiming(null)
    if (!chore) return
    if (chore.mode === 'each') toggle(chore, person)
    else complete(chore, person)
  }

  const tap = (chore: DayChoreDto): void => {
    if (chore.mode === 'anyone' && chore.completed) mutations.uncomplete.mutate({ choreId: chore.choreId, date })
    else setClaiming(chore)
  }

  return {
    tap,
    toggle,
    dialog: <ClaimDialog chore={claiming} people={people} onPick={pick} onClose={() => setClaiming(null)} />
  }
}
