import { useState } from 'react'
import { DateTime } from 'luxon'
import type { ChoreDto, ChoreRoutine } from '@shared/types'
import { useBalances, useChoreMutations, useChores, useChoresDay, usePeople } from '../api/hooks'
import { Card, CheckCircle, EmptyNote, GhostButton, PersonAvatar, PrimaryButton, TextInput } from '../components/ui'

type Repeat = 'once' | 'daily' | 'weekly'

export function ChoresPage() {
  const today = DateTime.now().toISODate()!
  const { data: dayChores = [], isPending } = useChoresDay(today)
  const { data: people = [] } = usePeople()
  const { data: balances = [] } = useBalances()
  const mutations = useChoreMutations()
  const [showForm, setShowForm] = useState(false)
  const [showManage, setShowManage] = useState(false)
  // the chore whose "who did it?" picker is open
  const [claiming, setClaiming] = useState<string | null>(null)

  const balanceOf = (personId: string): number => balances.find((b) => b.personId === personId)?.balance ?? 0
  const done = dayChores.filter((c) => c.completed).length

  return (
    <div className="flex flex-col gap-4">
      {isPending && <EmptyNote>Loading…</EmptyNote>}
      {!isPending && dayChores.length === 0 && <EmptyNote>No chores today.</EmptyNote>}

      {dayChores.length > 0 && (
        <Card>
          <div className="mb-1 flex items-center gap-2.5">
            <h2 className="flex-1 truncate font-display text-xl font-semibold">Today</h2>
            <span className="text-sm font-extrabold text-ink-faint">
              {done}/{dayChores.length} done
            </span>
          </div>
          {dayChores.map((chore) => {
            const claimer = people.find((p) => p.id === chore.completedBy)
            return (
              <div key={chore.choreId} className="border-b border-line/60 last:border-0">
                <div className="flex items-center">
                  <CheckCircle
                    checked={chore.completed}
                    color={claimer?.color ?? '#999'}
                    onTap={() => {
                      if (chore.completed) mutations.uncomplete.mutate({ choreId: chore.choreId, date: today })
                      else setClaiming(claiming === chore.choreId ? null : chore.choreId)
                    }}
                    label={`${chore.completed ? 'Uncheck' : 'Check off'} ${chore.title}`}
                  />
                  <span className="min-w-0 flex-1 py-2">
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
                {claiming === chore.choreId && !chore.completed && (
                  <div className="flex flex-wrap items-center gap-2 pb-2.5">
                    <span className="text-sm font-extrabold text-ink-faint">Who did it?</span>
                    {people.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setClaiming(null)
                          mutations.complete.mutate({ choreId: chore.choreId, date: today, personId: p.id })
                        }}
                        className="pressable flex items-center gap-1.5 rounded-full bg-paper-deep py-1 pr-3 pl-1 text-sm font-extrabold text-ink-soft"
                      >
                        <PersonAvatar name={p.name} color={p.color} size="sm" />
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      )}

      {people.length > 0 && (
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
