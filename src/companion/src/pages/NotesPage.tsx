import { useState } from 'react'
import { DateTime } from 'luxon'
import type { NoteDto, PersonDto } from '@shared/types'
import { useNoteMutations, useNotes, usePeople } from '../api/hooks'
import { Card, EmptyNote, PersonAvatar, PrimaryButton } from '../components/ui'
import { CountdownsCard } from './CountdownsCard'

const AUTHOR_KEY = 'osl.noteAuthor'
const MAX_LENGTH = 280

function rememberedAuthor(): string | null {
  try {
    return localStorage.getItem(AUTHOR_KEY)
  } catch {
    return null
  }
}

/** Notes for the kiosk: post one from here, follow the conversation with the tablet, clear what's done. */
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
        <div className="flex flex-col gap-3">
          <div className="text-xs font-extrabold tracking-wide text-ink-faint uppercase">Conversations</div>
          {notes.map((n) => (
            <Conversation key={n.id} note={n} byId={byId} replyAs={author} />
          ))}
        </div>
      )}
      <CountdownsCard />
    </div>
  )
}

/** "2:15 pm", or "Mon 2:15 pm" for an older message. */
function when(iso: string): string {
  const t = DateTime.fromISO(iso)
  return (t.hasSame(DateTime.now(), 'day') ? t.toFormat('h:mm a') : t.toFormat('ccc h:mm a')).toLowerCase()
}

/**
 * A note and its replies, like a text thread: phone messages on the right, the tablet's on the
 * left. Replying to a done note puts it back on the kiosk.
 */
function Conversation({
  note,
  byId,
  replyAs
}: {
  note: NoteDto
  byId: Map<string, PersonDto>
  replyAs: PersonDto | null
}) {
  const { done, reply } = useNoteMutations()
  const [confirming, setConfirming] = useState(false)
  const [draft, setDraft] = useState('')
  const open = note.doneAt === null
  const messages = [
    { id: note.id, text: note.text, authorId: note.authorId, fromKiosk: false, createdAt: note.createdAt },
    ...note.replies
  ]
  function send(): void {
    reply.mutate({ noteId: note.id, text: draft.trim(), authorId: replyAs?.id ?? null }, { onSuccess: () => setDraft('') })
  }
  return (
    <div className={`rounded-2xl px-3 py-3 ${open ? 'bg-sun-soft ring-1 ring-sun' : 'bg-card'}`}>
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="flex-1 text-xs font-extrabold tracking-wide text-ink-faint uppercase">
          {open ? `On the kiosk${note.expiresAt ? ' · until tonight' : ''}` : 'Done'}
        </span>
        {open && (
          <button
            type="button"
            onClick={() => (confirming ? done.mutate({ id: note.id }) : setConfirming(true))}
            className={`pressable shrink-0 rounded-full px-3 py-1 text-sm font-extrabold ${confirming ? 'bg-ember text-white' : 'bg-card text-ink'}`}
          >
            {confirming ? 'Tap again' : '✓ Done'}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {messages.map((m) => {
          const who = m.fromKiosk ? 'Tablet' : (m.authorId ? byId.get(m.authorId)?.name : undefined)
          return (
            <div key={m.id} className={`flex max-w-[85%] flex-col ${m.fromKiosk ? 'items-start self-start' : 'items-end self-end'}`}>
              <p
                className={`rounded-2xl px-3 py-2 text-base font-bold break-words whitespace-pre-line ${
                  m.fromKiosk ? 'bg-ink text-paper' : 'bg-paper text-ink'
                }`}
              >
                {m.text}
              </p>
              <span className="mt-0.5 px-1 text-[11px] font-bold text-ink-faint">
                {who ? `${who} · ` : ''}
                {when(m.createdAt)}
              </span>
            </div>
          )
        })}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) send()
        }}
      >
        <input
          value={draft}
          maxLength={MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={open ? 'Reply…' : 'Reply (puts it back on the kiosk)…'}
          className="min-w-0 flex-1 rounded-full border-2 border-line bg-paper px-3 py-1.5 text-base font-semibold text-ink outline-none focus:border-ember"
        />
        <button
          type="submit"
          disabled={!draft.trim() || reply.isPending}
          className="pressable shrink-0 rounded-full bg-ember px-4 text-sm font-extrabold text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
      {reply.error && <p className="mt-1 px-1 text-xs font-bold text-ember-deep">{reply.error.message}</p>}
    </div>
  )
}
