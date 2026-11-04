import { useState } from 'react'
import { DateTime } from 'luxon'
import type { NoteDto, PersonDto } from '@shared/types'
import { useNoteMutations, useNotes, usePeople } from '../../api/hooks'
import { initials, textOn } from '../../lib/format'
import { ZONE } from '../../stores/uiStore'

/** "2:15 pm", or "Mon 2:15 pm" for an older note. */
export function noteTime(iso: string): string {
  const t = DateTime.fromISO(iso).setZone(ZONE)
  const time = t.toFormat('h:mm a').toLowerCase()
  return t.hasSame(DateTime.now().setZone(ZONE), 'day') ? time : `${t.toFormat('ccc')} ${time}`
}

/** Family notes posted from a phone: sticky cards above the home tiles, until someone taps Done. */
export function NotesStrip() {
  const { data: notes = [] } = useNotes()
  const { data: people = [] } = usePeople()
  if (notes.length === 0) return null
  const byId = new Map(people.map((p) => [p.id, p]))
  return (
    <div className="mb-4 flex shrink-0 gap-3 overflow-x-auto pb-1" aria-label="Family notes">
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} author={n.authorId ? byId.get(n.authorId) : undefined} />
      ))}
    </div>
  )
}

function NoteCard({ note, author }: { note: NoteDto; author: PersonDto | undefined }) {
  const { done } = useNoteMutations()
  // two taps, so a passing kid can't clear "Grandma's picking you up"
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="flex max-w-[30rem] min-w-[16rem] shrink-0 flex-col gap-2 rounded-2xl bg-sun-soft px-4 py-3 text-ink shadow-card ring-1 ring-sun">
      <p className="text-xl leading-snug font-bold break-words whitespace-pre-line">{note.text}</p>
      <div className="flex items-center gap-2 text-sm font-bold text-ink-soft">
        {author && (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold"
            style={{ backgroundColor: author.color, color: textOn(author.color) }}
          >
            {initials(author.name)}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">
          {author ? `${author.name} · ` : ''}
          {noteTime(note.createdAt)}
          {note.expiresAt && ' · until tonight'}
        </span>
        <button
          type="button"
          onClick={() => (confirming ? done.mutate({ id: note.id }) : setConfirming(true))}
          onBlur={() => setConfirming(false)}
          className={`pressable shrink-0 rounded-full px-3 py-1 text-sm font-extrabold ${
            confirming ? 'bg-ember text-white' : 'bg-card text-ink'
          }`}
        >
          {confirming ? 'Tap again' : '✓ Done'}
        </button>
      </div>
    </div>
  )
}
