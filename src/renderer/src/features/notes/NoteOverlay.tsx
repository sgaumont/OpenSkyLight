import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import type { NoteDto, PersonDto } from '@shared/types'
import { useNoteMutations, useNotes, usePeople } from '../../api/hooks'
import { initials, textOn } from '../../lib/format'
import { ZONE } from '../../stores/uiStore'
import { useKioskState } from '../../stores/kioskStore'
import { startNoteChime, stopNoteChime } from '../../lib/alarm'

/** "2:15 pm", or "Mon 2:15 pm" for an older note. */
function noteTime(iso: string): string {
  const t = DateTime.fromISO(iso).setZone(ZONE)
  const time = t.toFormat('h:mm a').toLowerCase()
  return t.hasSame(DateTime.now().setZone(ZONE), 'day') ? time : `${t.toFormat('ccc')} ${time}`
}

/** One-tap answers on the tablet. */
const QUICK_REPLIES = ['👍', '👎', 'Not Yet', 'On my way', 'Thanks!']
/** How many of the latest replies fit under the note. */
const SHOWN_REPLIES = 4

/** The phone has the last word: the tablet hasn't answered since. */
const waiting = (n: NoteDto): boolean => !(n.replies.at(-1)?.fromKiosk ?? false)

/**
 * A family note from a phone, centred over everything — the home screen, other screens and the
 * screensaver (but under the sleep screen) — until someone taps Done. Several notes show one at a
 * time: any still waiting for an answer first, then oldest first. Under the note is its
 * conversation with the phones; answer with a quick reply or type one. Dings every 10 seconds
 * while a note waits for the tablet to answer (quiet during sleep hours).
 */
export function NoteOverlay() {
  const { data: notes = [] } = useNotes()
  const { data: people = [] } = usePeople()
  const { done, reply } = useNoteMutations()
  // two taps, so a passing kid can't clear "Grandma's picking you up"; keyed to the note shown
  const [confirming, setConfirming] = useState<string | null>(null)
  // the typed-reply box, keyed to the note it's open on
  const [writing, setWriting] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // a ding every 10 seconds while a note waits for an answer — but not in quiet hours (sleep screen up)
  const sleeping = useKioskState((s) => s.sleeping)
  const ringing = notes.some(waiting) && !sleeping
  useEffect(() => {
    if (!ringing) return
    startNoteChime()
    return () => stopNoteChime()
  }, [ringing])
  if (notes.length === 0) return null
  const note = notes.find(waiting) ?? notes[0]
  const author = note.authorId ? people.find((p) => p.id === note.authorId) : undefined
  const armed = confirming === note.id
  const send = (text: string): void => {
    if (!text.trim()) return
    reply.mutate({ noteId: note.id, text: text.trim() })
    setWriting(null)
    setDraft('')
  }

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-ink/55 p-10 backdrop-blur-sm"
      // taps here belong to the note, never to the screensaver or screen underneath
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        role="alertdialog"
        aria-label="Family note"
        className="animate-pop flex max-h-full w-full max-w-3xl flex-col gap-6 overflow-y-auto rounded-3xl bg-sun-soft px-10 py-9 text-ink shadow-float ring-2 ring-sun"
      >
        <div className="flex items-center gap-3 text-base font-extrabold tracking-wider text-ink-faint uppercase">
          <span className="flex-1">Note</span>
          {notes.length > 1 && <span className="normal-case">1 of {notes.length}</span>}
        </div>
        <p className="text-4xl leading-tight font-bold break-words whitespace-pre-line">{note.text}</p>
        {note.replies.length > 0 && <Thread note={note} people={people} />}
        {writing === note.id ? (
          <form
            className="flex gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              send(draft)
            }}
          >
            <input
              autoFocus
              value={draft}
              maxLength={280}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a reply…"
              className="min-h-16 min-w-0 flex-1 rounded-2xl border-2 border-line bg-card px-5 text-2xl font-bold outline-none focus:border-ember"
            />
            <button
              type="submit"
              disabled={!draft.trim() || reply.isPending}
              className="pressable min-h-16 shrink-0 rounded-2xl bg-ember px-7 text-2xl font-extrabold text-white disabled:opacity-40"
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => setWriting(null)}
              className="pressable min-h-16 shrink-0 rounded-2xl bg-card px-5 text-2xl font-extrabold text-ink-soft"
            >
              ✕
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2.5">
            {QUICK_REPLIES.map((text) => (
              <button
                key={text}
                type="button"
                disabled={reply.isPending}
                onClick={() => send(text)}
                className="pressable min-h-14 rounded-full bg-card px-6 text-xl font-extrabold text-ink shadow-card disabled:opacity-40"
              >
                {text}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setDraft('')
                setWriting(note.id)
              }}
              className="pressable min-h-14 rounded-full bg-card px-6 text-xl font-extrabold text-ink-soft shadow-card"
            >
              ✏️ Write…
            </button>
          </div>
        )}
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

/** The conversation under a note: phone messages on the left, the tablet's answers on the right. */
function Thread({ note, people }: { note: NoteDto; people: PersonDto[] }) {
  const hidden = Math.max(0, note.replies.length - SHOWN_REPLIES)
  return (
    <div className="flex flex-col gap-2" aria-label="Replies">
      {hidden > 0 && <div className="text-base font-bold text-ink-faint">{hidden} earlier {hidden === 1 ? 'reply' : 'replies'}</div>}
      {note.replies.slice(hidden).map((r) => {
        const who = r.fromKiosk ? 'Tablet' : (people.find((p) => p.id === r.authorId)?.name ?? 'Phone')
        return (
          <div key={r.id} className={`flex max-w-[85%] flex-col ${r.fromKiosk ? 'items-end self-end' : 'items-start self-start'}`}>
            <div
              className={`rounded-2xl px-5 py-2.5 text-2xl font-bold break-words whitespace-pre-line ${
                r.fromKiosk ? 'bg-ink text-paper' : 'bg-card text-ink'
              }`}
            >
              {r.text}
            </div>
            <div className="mt-0.5 px-2 text-sm font-bold text-ink-faint">
              {who} · {noteTime(r.createdAt)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
