import { useEffect, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import type { ChatMessageDto, PersonDto } from '@shared/types'
import { useChat, useChatSend, usePeople } from '../api/hooks'
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

/** "2:15 pm", or "Mon 2:15 pm" for an older message. */
function when(iso: string): string {
  const t = DateTime.fromISO(iso)
  return (t.hasSame(DateTime.now(), 'day') ? t.toFormat('h:mm a') : t.toFormat('ccc h:mm a')).toLowerCase()
}

/** "Today", "Yesterday" or "Monday, Nov 3" — a divider between days. */
function dayLabel(iso: string): string {
  const d = DateTime.fromISO(iso).startOf('day')
  const diff = Math.round(DateTime.now().startOf('day').diff(d, 'days').days)
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toFormat('cccc, LLL d')
}

/**
 * Chat: one family conversation with the kiosk (and every other phone), newest at the bottom, like
 * a group text. Pick who you are once; it's remembered on this phone.
 */
export function NotesPage() {
  const { data: messages = [] } = useChat()
  const { data: people = [] } = usePeople()
  const send = useChatSend()
  const [text, setText] = useState('')
  const [authorId, setAuthorId] = useState<string | null>(rememberedAuthor)
  // a remembered author who has since been removed from the family no longer counts
  const author = people.find((p) => p.id === authorId) ?? null
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

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
    send.mutate({ text: text.trim(), authorId: author?.id ?? null }, { onSuccess: () => setText('') })
  }

  const byId = new Map(people.map((p) => [p.id, p]))
  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 ? (
        <EmptyNote>No messages yet — say hi to the kiosk below.</EmptyNote>
      ) : (
        <div className="flex flex-col gap-2" data-chat-timeline>
          {messages.map((m, i) => (
            <div key={m.id} className="flex flex-col gap-2">
              {(i === 0 || dayLabel(messages[i - 1].createdAt) !== dayLabel(m.createdAt)) && (
                <div className="self-center rounded-full bg-paper-deep px-3 py-0.5 text-[11px] font-extrabold text-ink-faint uppercase">
                  {dayLabel(m.createdAt)}
                </div>
              )}
              <Message m={m} byId={byId} me={author} />
            </div>
          ))}
        </div>
      )}

      <Card>
        <textarea
          value={text}
          maxLength={MAX_LENGTH}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Message the family…"
          className="w-full resize-none rounded-xl border-2 border-line bg-paper px-3 py-2 text-base font-semibold text-ink outline-none focus:border-ember"
        />
        {people.length > 0 && (
          <div className="mt-2">
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
        <div className="mt-3 flex items-center gap-3">
          <span className="flex-1 text-xs font-bold text-ink-faint">
            {text.length > MAX_LENGTH - 40 ? `${MAX_LENGTH - text.length} left` : ''}
          </span>
          <PrimaryButton onClick={post} disabled={text.trim() === '' || send.isPending}>
            {send.isPending ? 'Sending…' : 'Send'}
          </PrimaryButton>
        </div>
        {send.error && <p className="mt-1 text-xs font-bold text-ember-deep">{send.error.message}</p>}
      </Card>
      <div ref={bottom} />
      <CountdownsCard />
    </div>
  )
}

/** A message: mine (this phone's person) on the right, the tablet's and everyone else's on the left. */
function Message({ m, byId, me }: { m: ChatMessageDto; byId: Map<string, PersonDto>; me: PersonDto | null }) {
  const author = m.authorId ? byId.get(m.authorId) : undefined
  const mine = !m.fromKiosk && !!me && m.authorId === me.id
  const who = m.fromKiosk ? 'Tablet' : (author?.name ?? 'Phone')
  return (
    <div className={`flex max-w-[85%] flex-col ${mine ? 'items-end self-end' : 'items-start self-start'}`} data-chat-message>
      <p
        className={`rounded-2xl px-3 py-2 text-base font-bold break-words whitespace-pre-line ${
          mine ? 'bg-ember text-white' : m.fromKiosk ? 'bg-ink text-paper' : 'bg-card text-ink'
        }`}
      >
        {m.text}
      </p>
      <span className="mt-0.5 px-1 text-[11px] font-bold text-ink-faint">
        {mine ? '' : `${who} · `}
        {when(m.createdAt)}
      </span>
    </div>
  )
}
