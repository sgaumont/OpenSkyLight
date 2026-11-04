import { useState } from 'react'
import { DateTime } from 'luxon'
import { useNoteMutations, useNotes, usePeople } from '../../api/hooks'
import { initials, textOn } from '../../lib/format'
import { ZONE } from '../../stores/uiStore'

/** "2:15 pm", or "Mon 2:15 pm" for an older note. */
function noteTime(iso: string): string {
  const t = DateTime.fromISO(iso).setZone(ZONE)
  const time = t.toFormat('h:mm a').toLowerCase()
  return t.hasSame(DateTime.now().setZone(ZONE), 'day') ? time : `${t.toFormat('ccc')} ${time}`
}

/**
 * A family note from a phone, centred over everything — the home screen, other screens and the
 * screensaver (but under the sleep screen) — until someone taps Done. Several notes show one at a
 * time, oldest first.
 */
export function NoteOverlay() {
  const { data: notes = [] } = useNotes()
  const { data: people = [] } = usePeople()
  const { done } = useNoteMutations()
  // two taps, so a passing kid can't clear "Grandma's picking you up"; keyed to the note shown
  const [confirming, setConfirming] = useState<string | null>(null)
  if (notes.length === 0) return null
  const note = notes[0]
  const author = note.authorId ? people.find((p) => p.id === note.authorId) : undefined
  const armed = confirming === note.id

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-ink/55 p-10 backdrop-blur-sm"
      // taps here belong to the note, never to the screensaver or screen underneath
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        role="alertdialog"
        aria-label="Family note"
        className="animate-pop flex w-full max-w-3xl flex-col gap-6 rounded-3xl bg-sun-soft px-10 py-9 text-ink shadow-float ring-2 ring-sun"
      >
        <div className="flex items-center gap-3 text-base font-extrabold tracking-wider text-ink-faint uppercase">
          <span className="flex-1">Note</span>
          {notes.length > 1 && <span className="normal-case">1 of {notes.length}</span>}
        </div>
        <p className="text-4xl leading-tight font-bold break-words whitespace-pre-line">{note.text}</p>
        <div className="flex items-center gap-3">
          {author && (
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold"
              style={{ backgroundColor: author.color, color: textOn(author.color) }}
            >
              {initials(author.name)}
            </span>
          )}
          <span className="min-w-0 flex-1 text-lg font-bold text-ink-soft">
            {author ? `${author.name} · ` : ''}
            {noteTime(note.createdAt)}
            {note.expiresAt && ' · until tonight'}
          </span>
          <button
            type="button"
            onClick={() => {
              if (!armed) return setConfirming(note.id)
              setConfirming(null)
              done.mutate({ id: note.id })
            }}
            className={`pressable min-h-16 shrink-0 rounded-2xl px-8 text-2xl font-extrabold shadow-card ${
              armed ? 'bg-ember text-white' : 'bg-card text-ink'
            }`}
          >
            {armed ? 'Tap again' : '✓ Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
