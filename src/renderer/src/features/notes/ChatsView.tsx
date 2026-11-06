import { useState } from 'react'
import { DateTime } from 'luxon'
import type { NoteDto, PersonDto } from '@shared/types'
import { useNoteMutations, usePeople, useRecentChats } from '../../api/hooks'
import { BigButton, Toggle } from '../../components/ui'
import { OskInput } from '../../components/Osk'
import { ZONE } from '../../stores/uiStore'
import { waiting } from '@shared/chat'
import { QUICK_REPLIES } from './NoteOverlay'

const MAX_LENGTH = 280

/** "2:15 pm", or "Mon 2:15 pm" for an older message. */
function when(iso: string): string {
  const t = DateTime.fromISO(iso).setZone(ZONE)
  const time = t.toFormat('h:mm a').toLowerCase()
  return t.hasSame(DateTime.now().setZone(ZONE), 'day') ? time : `${t.toFormat('ccc')} ${time}`
}

/**
 * The tablet's Chats screen (top switcher: Home · Week · Month · Chats · Lists): start a chat to the
 * phones on the left, and read and answer every conversation from the last couple of days on the
 * right — the same list the phones see.
 */
export function ChatsView() {
  const { data: chats = [] } = useRecentChats(true)
  const { data: people = [] } = usePeople()
  const { start } = useNoteMutations()
  const [text, setText] = useState('')
  const [untilTonight, setUntilTonight] = useState(false)
  const byId = new Map(people.map((p) => [p.id, p]))
  const send = (): void => {
    if (!text.trim()) return
    start.mutate(
      { text: text.trim(), untilTonight },
      {
        onSuccess: () => {
          setText('')
          setUntilTonight(false)
        }
      }
    )
  }
  return (
    <div className="flex h-full gap-5 px-5 pb-5" data-chats-view>
      <div className="flex w-[26rem] shrink-0 flex-col gap-3 self-start rounded-3xl bg-card p-5 shadow-card">
        <div className="text-sm font-extrabold tracking-wide text-ink-faint uppercase">New chat to the phones</div>
        <OskInput value={text} onChange={(v) => setText(v.slice(0, MAX_LENGTH))} placeholder="e.g. Dinner's ready! 🍝" />
        <div className="flex items-center gap-3">
          <span className="flex-1 text-base font-semibold text-ink-soft">Until tonight — clears itself at midnight</span>
          <Toggle checked={untilTonight} onChange={setUntilTonight} label="Until tonight" />
        </div>
        <BigButton onClick={send} disabled={!text.trim() || start.isPending}>
          Send
        </BigButton>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
        {chats.length === 0 ? (
          <p className="py-10 text-center text-xl font-bold text-ink-faint">No chats in the last couple of days</p>
        ) : (
          chats.map((c) => <Conversation key={c.id} chat={c} byId={byId} />)
        )}
      </div>
    </div>
  )
}

/** One chat as a thread: phones on the left, the tablet on the right. */
function Conversation({ chat, byId }: { chat: NoteDto; byId: Map<string, PersonDto> }) {
  const { done, reply } = useNoteMutations()
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState(false)
  const open = chat.doneAt === null
  const messages = [
    { id: chat.id, text: chat.text, authorId: chat.authorId, fromKiosk: chat.fromKiosk, createdAt: chat.createdAt },
    ...chat.replies
  ]
  const answer = (t: string): void => {
    if (!t.trim()) return
    reply.mutate({ noteId: chat.id, text: t.trim() }, { onSuccess: () => setDraft('') })
  }
  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl p-4 ${open && waiting(chat) ? 'bg-sun-soft ring-2 ring-sun' : 'bg-card shadow-card'}`}
      data-chat
    >
      <div className="flex items-center gap-3">
        <span className="flex-1 text-sm font-extrabold tracking-wide text-ink-faint uppercase">
          {!open ? 'Done' : waiting(chat) ? 'Waiting for an answer' : 'On the kiosk'}
          {open && chat.expiresAt ? ' · until tonight' : ''}
        </span>
        {open && (
          <button
            type="button"
            onClick={() => (confirming ? done.mutate({ id: chat.id }) : setConfirming(true))}
            className={`pressable shrink-0 rounded-full px-4 py-1.5 text-base font-extrabold ${confirming ? 'bg-ember text-white' : 'bg-paper-deep text-ink'}`}
          >
            {confirming ? 'Tap again' : '✓ Done'}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {messages.map((m) => {
          const who = m.fromKiosk ? 'Tablet' : ((m.authorId ? byId.get(m.authorId)?.name : undefined) ?? 'Phone')
          return (
            <div key={m.id} className={`flex max-w-[80%] flex-col ${m.fromKiosk ? 'items-end self-end' : 'items-start self-start'}`}>
              <div
                className={`rounded-2xl px-4 py-2 text-xl font-bold break-words whitespace-pre-line ${
                  m.fromKiosk ? 'bg-ink text-paper' : 'bg-paper text-ink'
                }`}
              >
                {m.text}
              </div>
              <div className="mt-0.5 px-2 text-sm font-bold text-ink-faint">
                {who} · {when(m.createdAt)}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {QUICK_REPLIES.map((q) => (
          <button
            key={q}
            type="button"
            disabled={reply.isPending}
            onClick={() => answer(q)}
            className="pressable rounded-full bg-paper-deep px-4 py-1.5 text-base font-extrabold text-ink disabled:opacity-40"
          >
            {q}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <OskInput value={draft} onChange={(v) => setDraft(v.slice(0, MAX_LENGTH))} placeholder="Reply…" />
        </div>
        <BigButton variant="ghost" onClick={() => answer(draft)} disabled={!draft.trim() || reply.isPending}>
          Send
        </BigButton>
      </div>
    </div>
  )
}
