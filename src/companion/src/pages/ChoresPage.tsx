import { useState, type ReactNode } from 'react'
import { DateTime } from 'luxon'
import type { ChoreDto, ChoreRoutine, DayChoreDto, PersonDto } from '@shared/types'
import { useAdjustStars, useBalances, useChecklistsDay, useChoreMutations, useChores, useChoresDay, usePeople } from '../api/hooks'
import { Card, CheckCircle, EmptyNote, GhostButton, PersonAvatar, PrimaryButton, TextInput } from '../components/ui'
import { sortDayChores } from '@shared/choreOrder'

type Repeat = 'once' | 'daily' | 'weekly'

/** Per-person "N today · ★ N" card below the chores: hidden for now (the Stars card covers it). */
const SHOW_FAMILY_SUMMARY = false

const STEP_BUTTON =
  'pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper-deep text-2xl font-extrabold text-ink-soft disabled:opacity-30'

/** Each child's star balance with − / + (one star a tap); tap the name to type a new total. */
function StarsCard({ people, balanceOf }: { people: PersonDto[]; balanceOf: (id: string) => number }) {
  const kids = people.filter((p) => p.role === 'child')
  const shown = kids.length > 0 ? kids : people
  const [editing, setEditing] = useState<PersonDto | null>(null)
  const adjust = useAdjustStars()
  if (shown.length === 0) return null
  return (
    <>
      <Card>
        <h2 className="mb-1 font-display text-xl font-semibold">Stars</h2>
        {shown.map((p) => {
          const stars = balanceOf(p.id)
          return (
            <div key={p.id} className="flex items-center gap-2 border-b border-line/60 py-2 last:border-0">
              <button
                type="button"
                onClick={() => setEditing(p)}
                className="pressable flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <PersonAvatar name={p.name} color={p.color} />
                <span className="min-w-0 flex-1 truncate text-base font-bold">{p.name}</span>
              </button>
              <button
                type="button"
                aria-label={`One star less for ${p.name}`}
                disabled={stars <= 0}
                onClick={() => adjust.mutate({ personId: p.id, delta: -1 })}
                className={STEP_BUTTON}
              >
                −
              </button>
              <span className="min-w-14 text-center text-lg font-extrabold text-ember-deep tabular-nums">★ {stars}</span>
              <button
                type="button"
                aria-label={`One star more for ${p.name}`}
                onClick={() => adjust.mutate({ personId: p.id, delta: 1 })}
                className={STEP_BUTTON}
              >
                +
              </button>
            </div>
          )
        })}
      </Card>
      {editing && <EditStarsSheet person={editing} current={balanceOf(editing.id)} onClose={() => setEditing(null)} />}
    </>
  )
}

/** A bottom sheet over a dimmed page; tapping outside it closes it. */
function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="w-full rounded-t-3xl bg-card p-5"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

/** "Who did it?" for a chore anyone can do: one big button per family member. */
function ClaimSheet({
  chore,
  people,
  onPick,
  onClose
}: {
  chore: DayChoreDto
  people: PersonDto[]
  onPick: (personId: string) => void
  onClose: () => void
}) {
  return (
    <Sheet onClose={onClose}>
      <h2 className="truncate font-display text-xl font-semibold">{chore.title}</h2>
      <p className="mb-3 text-sm font-extrabold text-ink-faint">
        Who did it?{chore.starsValue > 0 ? ` · ★ ${chore.starsValue}` : ''}
      </p>
      <div className="mb-3 flex flex-col gap-2">
        {people.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            className="pressable flex min-h-14 items-center gap-3 rounded-2xl bg-paper-deep px-3 text-left text-lg font-extrabold"
          >
            <PersonAvatar name={p.name} color={p.color} />
            {p.name}
          </button>
        ))}
      </div>
      <div className="flex [&>*]:flex-1">
        <GhostButton onClick={onClose}>Cancel</GhostButton>
      </div>
    </Sheet>
  )
}

/** Set a child's balance: − / + or type the new total; saved as one manual adjustment. */
function EditStarsSheet({ person, current, onClose }: { person: PersonDto; current: number; onClose: () => void }) {
  const adjust = useAdjustStars()
  const [text, setText] = useState(String(current))
  const target = /^\d+$/.test(text.trim()) ? Number(text.trim()) : null
  const set = (n: number) => setText(String(Math.max(0, n)))
  const save = () => {
    if (target === null) return
    adjust.mutate({ personId: person.id, delta: target - current }, { onSuccess: onClose })
  }
  return (
    <Sheet onClose={onClose}>
      <div className="mb-4 flex items-center gap-2.5">
        <PersonAvatar name={person.name} color={person.color} />
        <h2 className="flex-1 truncate font-display text-xl font-semibold">{person.name}'s stars</h2>
        <span className="text-sm font-extrabold text-ink-faint">now ★ {current}</span>
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

/** An "everyone" chore: one button per person; a tap ticks or un-ticks just them. */
function EachChoreRow({ chore, people, date }: { chore: DayChoreDto; people: PersonDto[]; date: string }) {
  const mutations = useChoreMutations()
  return (
    <div className="border-b border-line/60 py-2 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`min-w-0 flex-1 truncate text-base font-semibold ${chore.completed ? 'text-ink-faint line-through' : ''}`}>
          {chore.title}
        </span>
        {chore.starsValue > 0 && <span className="shrink-0 text-sm font-extrabold text-ink-faint">★ {chore.starsValue}</span>}
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
                done
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
            </button>
          )
        })}
      </div>
    </div>
  )
}

const UNLOCK_TEXT = { pending: 'waiting for a parent', approved: 'unlocked!' } as const

export function ChoresPage() {
  const today = DateTime.now().toISODate()!
  const { data: dayChores = [], isPending } = useChoresDay(today)
  const { data: checklists = [] } = useChecklistsDay(today)
  const { data: people = [] } = usePeople()
  const { data: balances = [] } = useBalances()
  const mutations = useChoreMutations()
  const [showForm, setShowForm] = useState(false)
  const [showManage, setShowManage] = useState(false)
  // the chore whose "who did it?" picker is open
  const [claiming, setClaiming] = useState<DayChoreDto | null>(null)

  const balanceOf = (personId: string): number => balances.find((b) => b.personId === personId)?.balance ?? 0
  const done = dayChores.filter((c) => c.completed).length

  return (
    <div className="flex flex-col gap-4">
      <StarsCard people={people} balanceOf={balanceOf} />

      {isPending && <EmptyNote>Loading…</EmptyNote>}
      {!isPending && dayChores.length === 0 && checklists.length === 0 && <EmptyNote>No chores today.</EmptyNote>}

      {checklists.map((cl) => (
        <Card key={cl.checklistId}>
          <h2 className="font-display text-xl font-semibold">🎮 {cl.title}</h2>
          <div className="mb-1 text-sm font-extrabold text-ink-faint">
            {cl.people
              .map((s) => {
                const name = people.find((p) => p.id === s.personId)?.name ?? '?'
                return `${name} ${s.unlock === 'locked' ? `${s.done}/${s.total}` : UNLOCK_TEXT[s.unlock]}`
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
            if (chore.mode === 'each') return <EachChoreRow key={chore.choreId} chore={chore} people={people} date={today} />
            const claimer = people.find((p) => p.id === chore.completedBy)
            // done: a tap un-ticks it; to do: a tap asks who did it
            const tap = () => {
              if (chore.completed) mutations.uncomplete.mutate({ choreId: chore.choreId, date: today })
              else setClaiming(chore)
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
                    {claimer && <span className="block truncate text-xs font-extrabold text-ink-faint">{claimer.name}</span>}
                  </span>
                  {chore.starsValue > 0 && (
                    <span className="shrink-0 text-sm font-extrabold text-ink-faint">★ {chore.starsValue}</span>
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
          onClose={() => setClaiming(null)}
          onPick={(personId) => {
            setClaiming(null)
            mutations.complete.mutate({ choreId: claiming.choreId, date: today, personId })
          }}
        />
      )}

      {SHOW_FAMILY_SUMMARY && people.length > 0 && (
        <Card>
          {people.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 py-1">
              <PersonAvatar name={p.name} color={p.color} />
              <span className="min-w-0 flex-1 truncate text-base font-bold">{p.name}</span>
              <span className="text-sm font-extrabold text-ink-faint">
                {dayChores.filter((c) => c.completedBy === p.id).length} today · ★ {balanceOf(p.id)}
              </span>
            </div>
          ))}
        </Card>
      )}

      {showForm ? (
        <NewChoreForm
          onCreate={(input) => {
            mutations.create.mutate(input)
            setShowForm(false)
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <GhostButton onClick={() => setShowForm(true)}>+ New chore</GhostButton>
      )}

      <GhostButton onClick={() => setShowManage((v) => !v)}>
        {showManage ? 'Hide all chores' : 'Manage all chores'}
      </GhostButton>
      {showManage && <ManageChores />}
    </div>
  )
}

function NewChoreForm({
  onCreate,
  onCancel
}: {
  onCreate: (input: {
    title: string
    starsValue: number
    recurrence: { freq: 'daily' | 'weekly'; byWeekdays?: number[] } | null
    anchorDate: string
    routine: ChoreRoutine
  }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [stars, setStars] = useState(1)
  const [repeat, setRepeat] = useState<Repeat>('daily')
  const today = DateTime.now()

  const submit = (): void => {
    if (!title.trim()) return
    onCreate({
      title: title.trim(),
      starsValue: stars,
      // rrule convention: 0 = Monday … 6 = Sunday; luxon weekday is 1–7
      recurrence:
        repeat === 'once'
          ? null
          : repeat === 'daily'
            ? { freq: 'daily' }
            : { freq: 'weekly', byWeekdays: [today.weekday - 1] },
      anchorDate: today.toISODate()!,
      routine: null
    })
  }

  return (
    <Card>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <TextInput value={title} onChange={setTitle} placeholder="Chore (e.g. Feed the dog)" autoFocus />
        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-xl bg-paper-deep">
            {(['once', 'daily', 'weekly'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRepeat(r)}
                className={`min-h-11 px-3 text-sm font-extrabold ${repeat === r ? 'bg-card shadow-card' : 'text-ink-soft'}`}
              >
                {r === 'once' ? 'Just today' : r === 'daily' ? 'Every day' : `${today.toFormat('cccc')}s`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Fewer stars"
              onClick={() => setStars((s) => Math.max(0, s - 1))}
              className="pressable h-11 w-11 rounded-xl bg-paper-deep text-lg font-extrabold"
            >
              −
            </button>
            <span className="min-w-10 text-center text-base font-extrabold">★ {stars}</span>
            <button
              type="button"
              aria-label="More stars"
              onClick={() => setStars((s) => Math.min(99, s + 1))}
              className="pressable h-11 w-11 rounded-xl bg-paper-deep text-lg font-extrabold"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <PrimaryButton type="submit" disabled={!title.trim()}>
            Add chore
          </PrimaryButton>
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
        </div>
      </form>
    </Card>
  )
}

function ManageChores() {
  const { data: chores = [] } = useChores()
  if (chores.length === 0) return <EmptyNote>No chores defined yet.</EmptyNote>
  return (
    <div className="flex flex-col gap-3">
      {chores.map((chore) => (
        <ManageChoreRow key={chore.id} chore={chore} />
      ))}
    </div>
  )
}

function ManageChoreRow({ chore }: { chore: ChoreDto }) {
  const mutations = useChoreMutations()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(chore.title)

  return (
    <Card className={chore.active ? '' : 'opacity-60'}>
      <div className="flex items-center gap-2.5">
        {editing ? (
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (title.trim()) mutations.update.mutate({ id: chore.id, title: title.trim() })
              setEditing(false)
            }}
          >
            <TextInput value={title} onChange={setTitle} autoFocus />
            <PrimaryButton type="submit">Save</PrimaryButton>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="pressable min-w-0 flex-1 truncate py-1 text-left text-base font-bold"
          >
            {chore.title}
            <span className="ml-2 text-sm font-extrabold text-ink-faint">★ {chore.starsValue}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => mutations.update.mutate({ id: chore.id, active: !chore.active })}
          className="pressable shrink-0 rounded-lg bg-paper-deep px-2.5 py-1.5 text-sm font-extrabold text-ink-soft"
        >
          {chore.active ? 'Pause' : 'Resume'}
        </button>
      </div>
    </Card>
  )
}
