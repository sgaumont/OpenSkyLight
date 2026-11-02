import { useState, type ReactNode } from 'react'
import type { DayChoreDto, PersonDto } from '@shared/types'
import { useChoreMutations, usePeople } from '../../api/hooks'
import { useToasts } from '../../stores/toastStore'
import { initials, textOn } from '../../lib/format'
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

/**
 * Tapping a chore anywhere: an open one asks "Who did it?" and credits the pick;
 * a done one is un-ticked (its stars go back). Render `dialog` once alongside the list.
 */
export function useChoreClaim(date: string): { tap: (chore: DayChoreDto) => void; dialog: ReactNode } {
  const { data: people = [] } = usePeople()
  const mutations = useChoreMutations()
  const pushToast = useToasts((s) => s.push)
  const [claiming, setClaiming] = useState<DayChoreDto | null>(null)

  const claim = (person: PersonDto): void => {
    const chore = claiming
    setClaiming(null)
    if (!chore) return
    mutations.complete.mutate(
      { choreId: chore.choreId, date, personId: person.id },
      {
        onSuccess: () =>
          pushToast(chore.starsValue > 0 ? `★ ${chore.starsValue} for ${person.name}!` : `Thanks, ${person.name}!`)
      }
    )
  }

  const tap = (chore: DayChoreDto): void => {
    if (chore.completed) mutations.uncomplete.mutate({ choreId: chore.choreId, date })
    else setClaiming(chore)
  }

  return {
    tap,
    dialog: <ClaimDialog chore={claiming} people={people} onPick={claim} onClose={() => setClaiming(null)} />
  }
}
