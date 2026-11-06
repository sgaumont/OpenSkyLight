import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import type { ChatMessageDto, PersonDto } from '@shared/types'
import { useChat, useChatMutations, usePeople } from '../../api/hooks'
import { initials, textOn } from '../../lib/format'
import { ZONE } from '../../stores/uiStore'
import { useKioskState } from '../../stores/kioskStore'
import { startNoteChime, stopNoteChime } from '../../lib/alarm'

/** "2:15 pm", or "Mon 2:15 pm" for an older message. */
export function chatTime(iso: string): string {
  const t = DateTime.fromISO(iso).setZone(ZONE)
  const time = t.toFormat('h:mm a').toLowerCase()
  return t.hasSame(DateTime.now().setZone(ZONE), 'day') ? time : `${t.toFormat('ccc')} ${time}`
}

/** One-tap answers on the tablet. */
export const QUICK_REPLIES = ['👍', '👎', 'Not Yet', 'On my way', 'Thanks!']
/** Messages from before the new ones, shown above them for context. */
const CONTEXT = 2

/**
 * New phone messages in the family conversation, centred over everything — every screen and the
 * screensaver (but under the sleep screen) — until the tablet answers (quick reply or typed) or
 * someone taps ✓ Seen twice. Dings every 10 seconds while a 🔔 Ring message waits (Quiet ones just show; quiet during sleep hours).
 */
export function NoteOverlay() {
  const { data: messages = [] } = useChat()
  const { data: people = [] } = usePeople()
  const { send, seen } = useChatMutations()
  // two taps, so a passing kid can't clear "Grandma's picking you up"
  const [confirming, setConfirming] = useState(false)
  const [writing, setWriting] = useState(false)
  const [draft, setDraft] = useState('')
  const unseen = messages.filter((m) => m.unseen)
  const sleeping = useKioskState((s) => s.sleeping)
  // the pop-up shows for every new phone message; it only chimes for ones sent with 🔔 Ring
  const ringing = unseen.some((m) => m.ring) && !sleeping
  useEffect(() => {
    if (!ringing) return
    startNoteChime()
    return () => stopNoteChime()
  }, [ringing])
  useEffect(() => {
    if (unseen.length === 0) {
      setConfirming(false)
      setWriting(false)
    }
  }, [unseen.length])
  if (unseen.length === 0) return null
  const firstNew = messages.findIndex((m) => m.unseen)
  const shown = messages.slice(Math.max(0, firstNew - CONTEXT))
  const answer = (text: string): void => {
    if (!text.trim()) return
    send.mutate({ text: text.trim() })
    setDraft('')
  }

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-ink/55 p-10 backdrop-blur-sm"
      // taps here belong to the chat, never to the screensaver or screen underneath
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        role="alertdialog"
        aria-label="Family chat"
        className="animate-pop flex max-h-full w-full max-w-3xl flex-col gap-5 overflow-y-auto rounded-3xl bg-sun-soft px-10 py-9 text-ink shadow-float ring-2 ring-sun"
      >
        <div className="flex items-center gap-3 text-base font-extrabold tracking-wider text-ink-faint uppercase">
          <span className="flex-1">Chat</span>
          <span className="normal-case">{unseen.length === 1 ? '1 new message' : `${unseen.length} new messages`}</span>
        </div>
        <div className="flex flex-col gap-2.5" data-chat-popup-messages>
          {shown.map((m) => (
            <Bubble key={m.id} m={m} people={people} big={m.unseen} />
          ))}
        </div>
        {writing ? (
          <form
            className="flex gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              answer(draft)
            }}
          >
            <input
              autoFocus
              value={draft}
              maxLength={280}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a message…"
              className="min-h-16 min-w-0 flex-1 rounded-2xl border-2 border-line bg-card px-5 text-2xl font-bold outline-none focus:border-ember"
            />
            <button
              type="submit"
              disabled={!draft.trim() || send.isPending}
              className="pressable min-h-16 shrink-0 rounded-2xl bg-ember px-7 text-2xl font-extrabold text-white disabled:opacity-40"
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => setWriting(false)}
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
                disabled={send.isPending}
                onClick={() => answer(text)}
                className="pressable min-h-14 rounded-full bg-card px-6 text-xl font-extrabold text-ink shadow-card disabled:opacity-40"
              >
                {text}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setDraft('')
                setWriting(true)
              }}
              className="pressable min-h-14 rounded-full bg-card px-6 text-xl font-extrabold text-ink-soft shadow-card"
            >
              ✏️ Write…
            </button>
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              if (!confirming) return setConfirming(true)
              setConfirming(false)
              seen.mutate(undefined)
            }}
            className={`pressable min-h-16 shrink-0 rounded-2xl px-8 text-2xl font-extrabold shadow-card ${
              confirming ? 'bg-ember text-white' : 'bg-card text-ink'
            }`}
          >
            {confirming ? 'Tap again' : '✓ Seen'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** A message bubble: phones on the left (with who), the tablet on the right. */
export function Bubble({ m, people, big = false }: { m: ChatMessageDto; people: PersonDto[]; big?: boolean }) {
  const author = m.authorId ? people.find((p) => p.id === m.authorId) : undefined
  const who = m.fromKiosk ? 'Tablet' : (m.deviceName ?? author?.name ?? 'Phone')
  return (
    <div className={`flex max-w-[85%] items-end gap-2 ${m.fromKiosk ? 'flex-row-reverse self-end' : 'self-start'}`} data-chat-message>
      {!m.fromKiosk && author && (
        <span
          className="mb-6 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold"
          style={{ backgroundColor: author.color, color: textOn(author.color) }}
        >
          {initials(author.name)}
        </span>
      )}
      <div className={`flex min-w-0 flex-col ${m.fromKiosk ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl px-5 py-2.5 font-bold break-words whitespace-pre-line ${big ? 'text-3xl' : 'text-xl'} ${
            m.fromKiosk ? 'bg-ink text-paper' : 'bg-paper-deep text-ink'
          } ${m.unseen ? 'ring-2 ring-ember' : ''}`}
          // a phone message wears its sender's colour, so it reads on light and dark panels alike
          style={!m.fromKiosk && author ? { backgroundColor: `${author.color}38`, boxShadow: m.unseen ? undefined : `inset 0 0 0 1.5px ${author.color}80` } : undefined}
        >
          {m.text}
        </div>
        <div className="mt-0.5 px-2 text-sm font-bold text-ink-faint">
          {who} · {chatTime(m.createdAt)}
        </div>
      </div>
    </div>
  )
}
