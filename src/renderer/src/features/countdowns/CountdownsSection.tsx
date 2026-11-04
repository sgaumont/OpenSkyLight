import { useState } from 'react'
import { DateTime } from 'luxon'
import type { CountdownDto } from '@shared/types'
import { COUNTDOWN_EMOJIS, countdownLabel } from '@shared/countdown'
import { useCountdownMutations, useCountdowns, useSettings } from '../../api/hooks'
import { BigButton, Dialog, FieldLabel } from '../../components/ui'
import { OskInput } from '../../components/Osk'
import { DateField } from '../../components/DateTimePickers'
import { PlusIcon } from '../../components/icons'
import { ZONE } from '../../stores/uiStore'

/** Settings → General: the countdowns shown on the Countdowns tile and the screensaver. */
export function CountdownsSection() {
  const { data: countdowns = [] } = useCountdowns()
  const { data: settings } = useSettings()
  const mutations = useCountdownMutations()
  const today = DateTime.now().setZone(ZONE).toISODate()!
  const [editing, setEditing] = useState<CountdownDto | 'new' | null>(null)
  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState<string>(COUNTDOWN_EMOJIS[0])
  const [date, setDate] = useState(today)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const open = (c: CountdownDto | 'new'): void => {
    setEditing(c)
    setConfirmDelete(false)
    setTitle(c === 'new' ? '' : c.title)
    setEmoji(c === 'new' ? COUNTDOWN_EMOJIS[0] : (c.emoji ?? COUNTDOWN_EMOJIS[0]))
    setDate(c === 'new' ? DateTime.now().setZone(ZONE).plus({ weeks: 1 }).toISODate()! : c.date)
  }

  const save = (): void => {
    if (!title.trim() || !editing) return
    const input = { title: title.trim(), emoji, date }
    if (editing === 'new') mutations.create.mutate(input)
    else mutations.update.mutate({ id: editing.id, ...input })
    setEditing(null)
  }

  return (
    <div>
      <FieldLabel>⏳ Countdowns</FieldLabel>
      <div className="flex flex-col gap-2">
        {countdowns.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => open(c)}
            className="pressable flex items-center gap-3 rounded-2xl bg-paper-deep/50 p-3 text-left"
          >
            <span className="text-2xl">{c.emoji ?? '⏳'}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg font-bold">{c.title}</span>
              <span className="block text-sm font-bold text-ink-faint">{DateTime.fromISO(c.date).toFormat('cccc, LLL d, yyyy')}</span>
            </span>
            <span className="text-base font-extrabold text-ember-deep">{countdownLabel(c.date, today)}</span>
          </button>
        ))}
        <BigButton variant="ghost" onClick={() => open('new')}>
          <span className="flex items-center justify-center gap-2">
            <PlusIcon size={20} /> Add countdown
          </span>
        </BigButton>
        <p className="text-sm font-semibold text-ink-faint">
          Shown on the Countdowns home tile (add it with ✏️ on the home screen) and on the screensaver. Each one drops off
          after its day.
        </p>
      </div>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add countdown' : 'Edit countdown'}>
        <div className="flex flex-col gap-4">
          <div>
            <FieldLabel>Counting down to</FieldLabel>
            <OskInput value={title} onChange={setTitle} placeholder="e.g. Christmas" autoFocus={editing === 'new'} />
          </div>
          <div>
            <FieldLabel>Emoji</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {COUNTDOWN_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-pressed={emoji === e}
                  onClick={() => setEmoji(e)}
                  className={`pressable h-12 w-12 rounded-full text-2xl ${emoji === e ? 'bg-ember-soft ring-2 ring-ember' : 'bg-paper-deep'}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <DateField label="Date" value={date} onChange={setDate} weekStartsOn={settings?.weekStartsOn ?? 0} />
          <div className="mt-1 flex gap-3">
            {editing !== 'new' && editing && (
              <BigButton
                variant="danger"
                onClick={() => {
                  if (!confirmDelete) return setConfirmDelete(true)
                  mutations.remove.mutate({ id: editing.id })
                  setEditing(null)
                }}
              >
                {confirmDelete ? 'Tap again to delete' : 'Delete'}
              </BigButton>
            )}
            <div className="flex-1" />
            <BigButton variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </BigButton>
            <BigButton onClick={save} disabled={!title.trim() || date < today}>
              Save
            </BigButton>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
