import { DateTime } from 'luxon'
import type { DayChoreDto, PersonDto } from '@shared/types'
import { choreHistoryDates } from '@shared/choreHistory'
import { useChecklistsDay, useChoresDay, usePeople } from '../../api/hooks'
import { ZONE } from '../../stores/uiStore'
import { BigButton, Dialog } from '../../components/ui'
import { Avatar } from './ClaimChore'

function dayLabel(date: string, index: number): string {
  if (index === 0) return 'Today'
  if (index === 1) return 'Yesterday'
  return DateTime.fromISO(date, { zone: ZONE }).toFormat('cccc, LLL d')
}

/** Who did which chores on one day: each person with the chores they ticked, in list order. */
function HistoryDay({ date, label, people }: { date: string; label: string; people: PersonDto[] }) {
  const { data: chores = [], isPending } = useChoresDay(date)
  const { data: checklists = [] } = useChecklistsDay(date)
  const all: DayChoreDto[] = [...checklists.flatMap((cl) => cl.items), ...chores]
  // one entry per chore they did, "×2" when they did it more than once that day
  const rows = people
    .map((p) => {
      const did = all
        .map((c) => ({ title: c.title, n: c.claims.filter((id) => id === p.id).length }))
        .filter((d) => d.n > 0)
      return {
        person: p,
        count: did.reduce((sum, d) => sum + d.n, 0),
        titles: did.map((d) => (d.n > 1 ? `${d.title} ×${d.n}` : d.title))
      }
    })
    .filter((r) => r.titles.length > 0)
  return (
    <section>
      <h3 className="mb-1.5 text-sm font-extrabold tracking-wide text-ink-faint uppercase">{label}</h3>
      {isPending ? null : rows.length === 0 ? (
        <p className="text-base font-semibold text-ink-faint">No chores done</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(({ person, count, titles }) => (
            <div key={person.id} className="flex items-start gap-2.5">
              <Avatar person={person} size="h-9 w-9 text-xs" />
              <div className="min-w-0 flex-1">
                <div className="text-base font-bold">
                  {person.name} <span className="text-ink-faint">· {count}</span>
                </div>
                <div className="text-sm font-semibold break-words text-ink-soft">{titles.join(', ')}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** The last few days of chores — who did what — opened from the home chores tile's title. */
export function ChoreHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: people = [] } = usePeople()
  const dates = choreHistoryDates(DateTime.now().setZone(ZONE).toISODate()!, ZONE)
  return (
    <Dialog open={open} onClose={onClose} title="Chore history">
      <div className="flex flex-col gap-4">
        {dates.map((date, i) => (
          <HistoryDay key={date} date={date} label={dayLabel(date, i)} people={people} />
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <BigButton variant="ghost" onClick={onClose}>
          Close
        </BigButton>
      </div>
    </Dialog>
  )
}
