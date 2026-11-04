import { useState } from 'react'
import { DateTime } from 'luxon'
import { COUNTDOWN_EMOJIS, countdownLabel } from '@shared/countdown'
import { useCountdownMutations, useCountdowns } from '../api/hooks'
import { Card, PrimaryButton } from '../components/ui'

/** Countdowns for the kiosk ("51 days until Christmas"): add one with a day, or delete one. */
export function CountdownsCard() {
  const { data: countdowns = [] } = useCountdowns()
  const { create, remove } = useCountdownMutations()
  const today = DateTime.now().toISODate()!
  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState<string>(COUNTDOWN_EMOJIS[0])
  const [date, setDate] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const valid = title.trim() !== '' && date >= today

  const add = (): void => {
    if (!valid) return
    create.mutate(
      { title: title.trim(), emoji, date },
      {
        onSuccess: () => {
          setTitle('')
          setDate('')
          setEmoji(COUNTDOWN_EMOJIS[0])
        }
      }
    )
  }

  return (
    <Card>
      <h2 className="mb-2 font-display text-xl font-semibold">⏳ Countdowns</h2>
      {countdowns.length > 0 && (
        <div className="mb-3 flex flex-col divide-y divide-line/60">
          {countdowns.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 py-2" data-countdown>
              <span className="text-2xl">{c.emoji ?? '⏳'}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-bold">{c.title}</span>
                <span className="block text-xs font-bold text-ink-faint">{DateTime.fromISO(c.date).toFormat('ccc LLL d')}</span>
              </span>
              <span className="shrink-0 text-sm font-extrabold text-ember-deep">{countdownLabel(c.date, today)}</span>
              <button
                type="button"
                aria-label={`Delete ${c.title}`}
                onClick={() => (confirming === c.id ? remove.mutate({ id: c.id }) : setConfirming(c.id))}
                className={`pressable shrink-0 rounded-full px-3 py-1.5 text-xs font-extrabold ${
                  confirming === c.id ? 'bg-ember text-white' : 'bg-paper-deep text-ink-soft'
                }`}
              >
                {confirming === c.id ? 'Tap to delete' : 'Delete'}
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        value={title}
        maxLength={60}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Counting down to… (e.g. Christmas)"
        className="min-h-11 w-full rounded-xl border-2 border-line bg-paper px-3 text-base font-semibold outline-none placeholder:text-ink-faint focus:border-ember"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {COUNTDOWN_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            aria-pressed={emoji === e}
            onClick={() => setEmoji(e)}
            className={`pressable h-10 w-10 rounded-full text-xl ${emoji === e ? 'bg-ember-soft ring-2 ring-ember' : 'bg-paper-deep'}`}
          >
            {e}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="date"
          aria-label="Date"
          value={date}
          min={today}
          onChange={(e) => setDate(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-xl border-2 border-line bg-paper px-3 text-base font-semibold outline-none focus:border-ember"
        />
        <PrimaryButton onClick={add} disabled={!valid || create.isPending}>
          Add
        </PrimaryButton>
      </div>
    </Card>
  )
}
