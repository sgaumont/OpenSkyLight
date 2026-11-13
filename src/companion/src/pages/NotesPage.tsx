import { useEffect, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import type { ChatMessageDto, PersonDto } from '@shared/types'
import { useChat, useChatSend, usePeople } from '../api/hooks'
import { EmptyNote, PrimaryButton } from '../components/ui'
import { currentSubscription } from '../api/push'
import { getPhoneName } from '../lib/phoneName'
import { CountdownsCard } from './CountdownsCard'

const AUTHOR_KEY = 'osl.noteAuthor'
/** ids of the messages this phone sent, so they sit on the right */
const SENT_KEY = 'osl.chatSent'
const SENT_MAX = 500

function sentIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SENT_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function rememberSent(id: string): void {
  try {
    const ids = [...sentIds(), id].slice(-SENT_MAX)
    localStorage.setItem(SENT_KEY, JSON.stringify(ids))
  } catch {
    // private browsing: only the older From pick counts
  }
}
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
 * a group text. Each message is 🔕 Quiet (shows everywhere, silently) unless 🔔 Ring is tapped for it.
 * Laid out like a messaging app (v0.8.177): the messages scroll and the message box stays pinned at
 * the bottom, above the tab bar. Countdowns sit at the top of the conversation (scroll up).
 */
export function NotesPage() {
  const { data: messages = [] } = useChat()
  const { data: people = [] } = usePeople()
  const send = useChatSend()
  const [text, setText] = useState('')
  // this message only: back to Quiet after every send
  const [ring, setRing] = useState(false)
  const [phoneName, setPhoneNameState] = useState(getPhoneName)
  const scroller = useRef<HTMLDivElement>(null)
  // newest message in view: on opening Chat, on every new message, and when the keyboard shrinks the view
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // the 📱 screen can rename this phone while Chat is open
  useEffect(() => {
    const onName = (): void => setPhoneNameState(getPhoneName())
    window.addEventListener('osl-phone-name', onName)
    return () => window.removeEventListener('osl-phone-name', onName)
  }, [])

  async function post(): Promise<void> {
    // this phone's notification address, so it isn't notified of its own message
    const endpoint = await currentSubscription()
      .then((s) => s?.endpoint ?? null)
      .catch(() => null)
    send.mutate(
      { text: text.trim(), ring, deviceName: phoneName || null, endpoint },
      {
        onSuccess: (m) => {
          rememberSent(m.id)
          setText('')
          setRing(false)
        }
      }
    )
  }

  const byId = new Map(people.map((p) => [p.id, p]))
  // messages from before Ring/Quiet, written as this phone's old "From" person, are still mine
  const legacyAuthor = rememberedAuthor()
  const sent = sentIds()
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-chat-page>
      <div
        ref={scroller}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pt-1 pb-3"
        data-chat-scroll
      >
        <CountdownsCard />
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
                <Message
                  m={m}
                  byId={byId}
                  mine={
                    !m.fromKiosk &&
                    (sent.has(m.id) ||
                      // sent under this phone's name from somewhere this page didn't see: a notification's Reply
                      (!!phoneName && m.deviceName === phoneName) ||
                      (!!legacyAuthor && m.authorId === legacyAuthor && !m.deviceName))
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* the message box, pinned under the conversation */}
      <div className="shrink-0 rounded-2xl bg-card p-2 shadow-card" data-chat-composer>
        {/* one row, like a messaging app: Quiet/Ring · the message · Send */}
        <div className="flex items-end gap-2">
          {/* per message: Quiet (default) shows silently everywhere; Ring makes it sound */}
          <button
            type="button"
            aria-pressed={ring}
            aria-label={ring ? 'Ring: this message will sound. Tap for quiet' : 'Quiet: this message shows silently. Tap to ring'}
            onClick={() => setRing((r) => !r)}
            className={`pressable flex min-h-11 min-w-11 items-center justify-center rounded-xl text-xl ${ring ? 'bg-ember shadow-card' : 'bg-paper-deep'}`}
            data-ring-toggle
          >
            {ring ? '🔔' : '🔕'}
          </button>
          <textarea
            value={text}
            maxLength={MAX_LENGTH}
            onChange={(e) => setText(e.target.value)}
            rows={text.includes('\n') || text.length > 26 ? 3 : 1}
            placeholder={ring ? 'Message (will ring)…' : 'Message the family…'}
            aria-label="Message"
            className="min-h-11 min-w-0 flex-1 resize-none rounded-xl border-2 border-line bg-paper px-3 py-2 text-base font-semibold text-ink outline-none focus:border-ember"
          />
          <PrimaryButton onClick={() => void post()} disabled={text.trim() === '' || send.isPending}>
            {send.isPending ? '…' : 'Send'}
          </PrimaryButton>
        </div>
        {text.length > MAX_LENGTH - 40 && (
          <p className="mt-1 text-right text-xs font-bold text-ink-faint">{MAX_LENGTH - text.length} left</p>
        )}
        {!phoneName && (
          <p className="mt-2 text-xs font-bold text-ink-faint" data-name-hint>
            Name this phone in 📱 (top right) so others see who's writing.
          </p>
        )}
        {send.error && <p className="mt-1 text-xs font-bold text-ember-deep">{send.error.message}</p>}
      </div>
    </div>
  )
}

/**
 * A message: outgoing (sent from this phone) on the right; incoming —
 * the tablet's and everyone else's — on the left.
 */
function Message({ m, byId, mine }: { m: ChatMessageDto; byId: Map<string, PersonDto>; mine: boolean }) {
  const author = m.authorId ? byId.get(m.authorId) : undefined
  const who = m.fromKiosk ? 'Tablet' : (m.deviceName ?? author?.name ?? 'Phone')
  return (
    <div
      className={`flex max-w-[85%] flex-col ${mine ? 'items-end self-end' : 'items-start self-start'}`}
      data-chat-message
      data-side={mine ? 'out' : 'in'}
    >
      <p
        className={`rounded-2xl px-3 py-2 text-base font-bold break-words whitespace-pre-line ${
          mine ? 'bg-ember text-right text-white' : m.fromKiosk ? 'bg-ink text-left text-paper' : 'bg-card text-left text-ink'
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
