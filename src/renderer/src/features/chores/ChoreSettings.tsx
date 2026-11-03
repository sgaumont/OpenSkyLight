import { useState } from 'react'
import { DateTime } from 'luxon'
import type { ChecklistDto, PersonDto } from '@shared/types'
import { defaultAssignees, scheduleOf, toRecurrence, type ScheduleKind } from '@shared/choreSchedule'
import { describeRecurrence } from '@shared/recurrence/build'
import { useChecklistMutations, useChecklists, usePendingUnlocks, usePeople } from '../../api/hooks'
import { ZONE } from '../../stores/uiStore'
import { textOn } from '../../lib/format'
import { BigButton, Dialog, FieldLabel, SegmentedControl } from '../../components/ui'
import { OskInput } from '../../components/Osk'
import { PlusIcon } from '../../components/icons'

const WEEKDAY_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** "Repeats": every day / chosen weekdays / one time. */
export function ScheduleField({
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
      <SegmentedControl
        value={schedule}
        onChange={onSchedule}
        options={[
          { value: 'daily', label: 'Every day' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'once', label: 'One time' }
        ]}
      />
      {schedule === 'weekly' && (
        <div className="mt-3 flex gap-2">
          {WEEKDAY_SHORT.map((label, i) => {
            const on = weekdays.includes(i)
            return (
              <button
                key={i}
                type="button"
                onClick={() => onWeekdays(on ? weekdays.filter((d) => d !== i) : [...weekdays, i])}
                className={`pressable flex h-11 w-11 items-center justify-center rounded-full text-base font-extrabold ${
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
export function PeoplePicker({
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
            className={`pressable rounded-full border-2 px-4 py-2 text-base font-bold ${
              on ? 'border-transparent' : 'border-line bg-card text-ink-soft'
            }`}
            style={on ? { backgroundColor: p.color, color: textOn(p.color) } : undefined}
          >
            {p.name}
          </button>
        )
      })}
    </div>
  )
}

/** Finished checklists waiting for a parent to sign off today. */
export function PendingUnlocks() {
  const today = DateTime.now().setZone(ZONE).toISODate()!
  const { data: pending = [] } = usePendingUnlocks(today)
  const { data: people = [] } = usePeople()
  const mutations = useChecklistMutations()
  return (
    <>
      {pending.map((u) => (
        <div key={`${u.checklistId}:${u.personId}`} className="flex items-center gap-3 rounded-2xl bg-sun-soft p-3">
          <span className="min-w-0 flex-1 truncate text-lg font-bold">
            {people.find((p) => p.id === u.personId)?.name ?? 'Someone'} finished 🎮 {u.title}
          </span>
          <BigButton onClick={() => mutations.approve.mutate({ checklistId: u.checklistId, personId: u.personId, date: u.date })}>
            Approve
          </BigButton>
        </div>
      ))}
    </>
  )
}

export function usePendingUnlockCount(): number {
  const { data: pending = [] } = usePendingUnlocks(DateTime.now().setZone(ZONE).toISODate()!)
  return pending.length
}

/** Checklists: a set of chores each person finishes to unlock something, signed off by a parent. */
export function ChecklistsSection() {
  const { data: people = [] } = usePeople()
  const { data: checklists = [] } = useChecklists()
  const mutations = useChecklistMutations()
  const [editing, setEditing] = useState<ChecklistDto | 'new' | null>(null)
  const [title, setTitle] = useState('')
  const [assignees, setAssignees] = useState<string[]>([])
  const [schedule, setSchedule] = useState<ScheduleKind>('weekly')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [items, setItems] = useState<{ id?: string; title: string }[]>([])

  const open = (c: ChecklistDto | 'new'): void => {
    setEditing(c)
    if (c === 'new') {
      setTitle('')
      setAssignees(defaultAssignees(people))
      setSchedule('weekly')
      setWeekdays([5, 6])
      setItems([{ title: '' }, { title: '' }, { title: '' }])
    } else {
      setTitle(c.title)
      setAssignees(c.assignees)
      setSchedule(scheduleOf(c.recurrence))
      setWeekdays(c.recurrence?.byWeekdays ?? [])
      setItems(c.items)
    }
  }

  const filled = items.map((i) => ({ ...i, title: i.title.trim() })).filter((i) => i.title)
  const valid = title.trim() !== '' && assignees.length > 0 && filled.length > 0

  const save = (): void => {
    if (!valid) return
    const input = { title: title.trim(), assignees, recurrence: toRecurrence(schedule, weekdays), items: filled }
    if (editing === 'new') mutations.create.mutate(input)
    else if (editing) mutations.update.mutate({ id: editing.id, ...input })
    setEditing(null)
  }

  return (
    <div>
      <FieldLabel>Checklists</FieldLabel>
      <div className="flex flex-col gap-2">
        {checklists.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => open(c)}
            className="pressable flex items-center gap-3 rounded-2xl bg-paper-deep/50 p-3 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg font-bold">🎮 {c.title}</span>
              <span className="block text-sm font-bold text-ink-faint">
                {c.items.map((i) => i.title).join(' · ')}
              </span>
              <span className="block text-sm font-bold text-ink-faint">
                {c.assignees
                  .map((id) => people.find((p) => p.id === id)?.name)
                  .filter(Boolean)
                  .join(', ')}{' '}
                · {c.recurrence ? describeRecurrence(c.recurrence) : 'One time'}
              </span>
            </span>
          </button>
        ))}
        <BigButton variant="ghost" onClick={() => open('new')} disabled={people.length === 0}>
          <span className="flex items-center justify-center gap-2">
            <PlusIcon size={20} /> Add checklist
          </span>
        </BigButton>
        <p className="text-sm font-semibold text-ink-faint">
          Each person does every item; when they've ticked them all, a parent approves it here and it's unlocked for
          the day.
        </p>
      </div>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add checklist' : 'Edit checklist'}>
        <div className="flex flex-col gap-4">
          <div>
            <FieldLabel>Unlocks</FieldLabel>
            <OskInput value={title} onChange={setTitle} placeholder="e.g. Video game time" autoFocus={editing === 'new'} />
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
                  <div className="min-w-0 flex-1">
                    <OskInput
                      value={item.title}
                      onChange={(v) => setItems(items.map((it, j) => (j === i ? { ...it, title: v } : it)))}
                      placeholder={['e.g. Go outside', 'e.g. Read for 15 minutes', 'e.g. Something artistic'][i] ?? 'Another item'}
                    />
                  </div>
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
              {items.length < 20 && (
                <BigButton variant="ghost" onClick={() => setItems([...items, { title: '' }])}>
                  <span className="flex items-center justify-center gap-2">
                    <PlusIcon size={18} /> Add item
                  </span>
                </BigButton>
              )}
            </div>
          </div>
          <ScheduleField schedule={schedule} weekdays={weekdays} onSchedule={setSchedule} onWeekdays={setWeekdays} />
          <div className="mt-1 flex gap-3">
            {editing !== 'new' && editing && (
              <BigButton
                variant="danger"
                onClick={() => {
                  mutations.remove.mutate({ id: editing.id })
                  setEditing(null)
                }}
              >
                Delete
              </BigButton>
            )}
            <div className="flex-1" />
            <BigButton variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </BigButton>
            <BigButton onClick={save} disabled={!valid}>
              Save
            </BigButton>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
