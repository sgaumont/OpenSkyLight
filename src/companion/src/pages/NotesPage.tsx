import { useState } from 'react'
import { DateTime } from 'luxon'
import type { NoteDto, PersonDto } from '@shared/types'
import { useNoteMutations, useNotes, usePeople } from '../api/hooks'
import { Card, EmptyNote, PersonAvatar, PrimaryButton } from '../components/ui'

const AUTHOR_KEY = 'osl.noteAuthor'
const MAX_LENGTH = 280

function rememberedAuthor(): string | null {
  try {
    return localStorage.getItem(AUTHOR_KEY)
  } catch {
    return null
  }
}

/** Notes for the kiosk: post one from here, see what's up there, clear what's done. */
export function NotesPage() {
  const { data: notes = [] } = useNotes()
  const { data: people = [] } = usePeople()
  const { add } = useNoteMutations()
  const [text, setText] = useState('')
  const [authorId, setAuthorId] = useState<string | null>(rememberedAuthor)
  const [untilTonight, setUntilTonight] = useState(false)
  // a remembered author who has since been removed from the family no longer counts
  const author = people.find((p) => p.id === authorId) ?? null

  function pickAuthor(id: string | null): void {
    setAuthorId(id)
    try {
      if (id) localStorage.setItem(AUTHOR_KEY, id)
      else localStorage.removeItem(AUTHOR_KEY)
    } catch {
      // private browsing: just not remembered
    }
  }

  function post(): void {
    add.mutate(
      { text: text.trim(), authorId: author?.id ?? null, untilTonight },
      {
        onSuccess: () => {
          setText('')
          setUntilTonight(false)
        }
      }
    )
  }

  const byId = new Map(people.map((p) => [p.id, p]))
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <textarea
          value={text}
          maxLength={MAX_LENGTH}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="e.g. Grandma is picking you up today 🚗"
          className="w-full resize-none rounded-xl border-2 border-line bg-paper px-3 py-2 text-base font-semibold text-ink outline-none focus:border-ember"
        />
        {people.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-xs font-extrabold tracking-wide text-ink-faint uppercase">From</div>
            <div className="flex flex-wrap gap-2">
              {people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={author?.id === p.id}
                  onClick={() => pickAuthor(author?.id === p.id ? null : p.id)}
                  className={`pressable flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-sm font-bold ${
                    author?.id === p.id ? 'bg-ink text-paper' : 'bg-paper-deep text-ink-soft'
                  }`}
                >
                  <PersonAvatar name={p.name} color={p.color} size="sm" />
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="mt-3 flex items-center gap-2 text-sm font-bold text-ink-soft">
          <input type="checkbox" checked={untilTonight} onChange={(e) => setUntilTonight(e.target.checked)} className="h-5 w-5 accent-ember" />
          Until tonight — clears itself at midnight
        </label>
        <div className="mt-3 flex items-center gap-3">
          <span className="flex-1 text-xs font-bold text-ink-faint">
            {text.length > MAX_LENGTH - 40 ? `${MAX_LENGTH - text.length} left` : ''}
          </span>
          <PrimaryButton onClick={post} disabled={text.trim() === '' || add.isPending}>
            {add.isPending ? 'Posting…' : 'Post to kiosk'}
          </PrimaryButton>
        </div>
      </Card>

      {notes.length === 0 ? (
        <EmptyNote>No notes on the kiosk right now.</EmptyNote>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-extrabold tracking-wide text-ink-faint uppercase">On the kiosk now</div>
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} author={n.authorId ? byId.get(n.authorId) : undefined} />
          ))}
        </div>
      )}
    </div>
  )
}

function NoteRow({ note, author }: { note: NoteDto; author: PersonDto | undefined }) {
  const { done } = useNoteMutations()
  const [confirming, setConfirming] = useState(false)
  const t = DateTime.fromISO(note.createdAt)
  const when = t.hasSame(DateTime.now(), 'day') ? t.toFormat('h:mm a').toLowerCase() : t.toFormat('ccc h:mm a').toLowerCase()
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-sun-soft px-4 py-3 ring-1 ring-sun">
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold break-words whitespace-pre-line text-ink">{note.text}</p>
        <p className="mt-1 text-xs font-bold text-ink-soft">
          {author ? `${author.name} · ` : ''}
          {when}
          {note.expiresAt && ' · until tonight'}
        </p>
      </div>
      <button
        type="button"
        onClick={() => (confirming ? done.mutate({ id: note.id }) : setConfirming(true))}
        className={`pressable shrink-0 rounded-full px-3 py-1.5 text-sm font-extrabold ${confirming ? 'bg-ember text-white' : 'bg-card text-ink'}`}
      >
        {confirming ? 'Tap again' : '✓ Done'}
      </button>
    </div>
  )
}
