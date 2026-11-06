import { useEffect, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import { useChat, useChatMutations, usePeople } from '../../api/hooks'
import { BigButton } from '../../components/ui'
import { OskInput, useOskHeight } from '../../components/Osk'
import { ZONE } from '../../stores/uiStore'
import { Bubble, QUICK_REPLIES } from './NoteOverlay'

const MAX_LENGTH = 280

/** "Today", "Yesterday" or "Monday, Nov 3" — a divider between days in the conversation. */
function dayLabel(iso: string): string {
  const d = DateTime.fromISO(iso).setZone(ZONE).startOf('day')
  const today = DateTime.now().setZone(ZONE).startOf('day')
  const diff = Math.round(today.diff(d, 'days').days)
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toFormat('cccc, LLL d')
}

/**
 * The tablet's Chat screen (top switcher: Home · Week · Month · Chat · Lists): the one family
 * conversation with the phones, newest at the bottom, and a box to keep it going.
 */
export function ChatsView() {
  const { data: messages = [] } = useChat()
  const { data: people = [] } = usePeople()
  const { send } = useChatMutations()
  const [text, setText] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  // the on-screen keyboard covers the bottom of the screen: lift the message box above it
  const osk = useOskHeight()
  // stay pinned to the newest message (and after the keyboard opens or closes)
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, osk])
  const post = (t: string): void => {
    if (!t.trim()) return
    send.mutate({ text: t.trim() }, { onSuccess: () => setText('') })
  }
  return (
    <div className="flex h-full flex-col px-5 pb-4" style={osk ? { paddingBottom: osk + 12 } : undefined} data-chats-view>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-3xl bg-card px-6 py-5 shadow-card">
        {messages.length === 0 ? (
          <p className="py-16 text-center text-xl font-bold text-ink-faint">No messages yet — say hi to the phones below</p>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m, i) => {
              const newDay = i === 0 || dayLabel(messages[i - 1].createdAt) !== dayLabel(m.createdAt)
              return (
                <div key={m.id} className="flex flex-col gap-3">
                  {newDay && (
                    <div className="my-1 self-center rounded-full bg-paper-deep px-4 py-1 text-sm font-extrabold text-ink-faint" data-chat-day>
                      {dayLabel(m.createdAt)}
                    </div>
                  )}
                  <Bubble m={m} people={people} />
                </div>
              )
            })}
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK_REPLIES.map((q) => (
          <button
            key={q}
            type="button"
            disabled={send.isPending}
            onClick={() => post(q)}
            className="pressable rounded-full bg-card px-5 py-2 text-lg font-extrabold text-ink shadow-card disabled:opacity-40"
          >
            {q}
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-3">
        <div className="flex-1">
          <OskInput value={text} onChange={(v) => setText(v.slice(0, MAX_LENGTH))} placeholder="Message the phones…" />
        </div>
        <BigButton onClick={() => post(text)} disabled={!text.trim() || send.isPending}>
          Send
        </BigButton>
      </div>
    </div>
  )
}
