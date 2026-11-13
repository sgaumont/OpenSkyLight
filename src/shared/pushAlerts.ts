import { timerTitle } from './gameTime'
/**
 * Phone notifications: which alerts are due, and what they say. Pure, so the rules are testable;
 * the main process gathers the state and does the sending (services/notifyService.ts).
 */

/** The alerts a phone can opt into — all off until that phone turns one on. */
export const PUSH_KINDS = ['chat', 'leave', 'approvals', 'weather', 'timers'] as const
export type PushKind = (typeof PUSH_KINDS)[number]
export type PushPrefs = Record<PushKind, boolean>

export const NO_PUSH: PushPrefs = { chat: false, leave: false, approvals: false, weather: false, timers: false }

/** What the phone shows for each alert, in its settings. */
export const PUSH_LABELS: Record<PushKind, string> = {
  chat: '💬 New chat messages',
  leave: '🚗 Time to leave for an event',
  approvals: '⭐ Approvals (chores and Shop)',
  weather: '⚠️ Weather warnings',
  timers: "⏳ A kid's timer is up"
}

/** The Android app's notification channels (each its own sound / importance setting on the phone). */
export type PushChannel = 'approvals' | 'shop' | 'timers' | 'chat_ring' | 'chat_quiet' | 'weather' | 'leave'

/**
 * A button on the Android notification: the app POSTs /api/rpc/<rpc> with `req` and its token.
 * `input: 'text'` = an inline reply box; the app adds the typed `text` (and who it is) to `req`.
 */
export interface PushAction {
  id: string
  label: string
  rpc: string
  req: Record<string, unknown>
  input?: 'text'
}

/** One notification to send. `key` makes it once-only; `tab` is where tapping it opens the phone app. */
export interface PushAlert {
  key: string
  kind: PushKind
  /** Android only (Web Push ignores it) */
  channel: PushChannel
  title: string
  body: string
  tab: 'notes' | 'chores'
  /** Android only: buttons on the notification */
  actions?: PushAction[]
  /** a family member's own phone doesn't get told about their own message */
  skipPersonId?: string | null
  /** the sending phone (its push endpoint) isn't told about its own message */
  skipEndpoint?: string | null
  /** shows on the phone without a sound or vibration (a chat message sent Quiet) */
  silent?: boolean
}

/** Too old to be news: a time-based alert missed by more than this (kiosk asleep, app restarted) is skipped. */
export const STALE_MS = 10 * 60_000

export interface PushState {
  nowMs: number
  names: Map<string, string>
  chat: {
    id: string
    text: string
    authorId: string | null
    fromKiosk: boolean
    createdAt: string
    /** false = sent Quiet: still a notification, just silent (missing = rings, as before) */
    ring?: boolean
    deviceName?: string | null
    senderEndpoint?: string | null
  }[]
  approvals: { checklistId: string; title: string; personId: string; date: string; kind: string; round?: number }[]
  /** Shop purchases waiting for a parent (sent with the approvals) */
  requests?: { id: string; personId: string; rewardTitle: string; starsSpent: number; minutes: number | null; currency?: 'stars' | 'coins' }[]
  leaves: { key: string; title: string; location: string; leaveAt: string; driveMinutes: number }[]
  timers: { id: string; personId: string; endsAt: string; title?: string }[]
  /** weather warnings and watches (statements and advisories don't buzz a phone) */
  weather: { id: string; title: string; area: string }[]
}

/** Chat's inline reply: the app fills in text, authorId, deviceName, endpoint and ring. */
const REPLY: PushAction = { id: 'reply', label: 'Reply', rpc: 'chat:send', req: {}, input: 'text' }

const clip = (s: string, n = 140): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Every alert the state calls for right now, before the "already sent" filter. */
export function dueAlerts(s: PushState): PushAlert[] {
  const name = (id: string | null | undefined): string => (id ? s.names.get(id) : undefined) ?? 'Someone'
  const recent = (iso: string): boolean => {
    const t = Date.parse(iso)
    return t <= s.nowMs && s.nowMs - t <= STALE_MS
  }
  const out: PushAlert[] = []
  for (const m of s.chat) {
    if (!recent(m.createdAt)) continue
    const from = m.fromKiosk ? 'Tablet' : m.deviceName || (m.authorId ? name(m.authorId) : 'Phone')
    out.push({
      key: `chat:${m.id}`,
      kind: 'chat',
      channel: !m.fromKiosk && m.ring === false ? 'chat_quiet' : 'chat_ring',
      title: `💬 ${from}`,
      body: clip(m.text),
      tab: 'notes',
      actions: [REPLY],
      skipPersonId: m.fromKiosk ? null : m.authorId,
      skipEndpoint: m.fromKiosk ? null : (m.senderEndpoint ?? null),
      // the tablet always rings; a phone message only when it was sent with 🔔 Ring
      silent: !m.fromKiosk && m.ring === false
    })
  }
  for (const a of s.approvals) {
    const what = a.kind === 'videogames' ? `${a.title}${a.round && a.round > 1 ? ` (round ${a.round})` : ''}` : a.title
    out.push({
      key: `approve:${a.checklistId}:${a.personId}:${a.date}:${a.round ?? 0}`,
      kind: 'approvals',
      channel: 'approvals',
      title: `⭐ ${name(a.personId)} finished ${what}`,
      body: 'Waiting for a parent to approve',
      tab: 'chores',
      actions: [
        {
          id: 'approve',
          label: 'Approve',
          rpc: 'chores:approveUnlock',
          req: { checklistId: a.checklistId, personId: a.personId, date: a.date, ...(a.round !== undefined ? { round: a.round } : {}) }
        }
      ]
    })
  }
  for (const q of s.requests ?? []) {
    out.push({
      key: `request:${q.id}`,
      kind: 'approvals',
      channel: 'shop',
      title: `🛒 ${name(q.personId)} wants ${q.rewardTitle}`,
      body: `${q.currency === 'coins' ? '🪙' : '⭐'} ${q.starsSpent}${q.minutes ? ` · ${q.minutes} min` : ''} — waiting for a parent to OK it`,
      tab: 'chores',
      actions: [
        { id: 'ok', label: 'OK', rpc: 'rewards:grant', req: { redemptionId: q.id } },
        { id: 'no', label: 'No', rpc: 'rewards:deny', req: { redemptionId: q.id } }
      ]
    })
  }
  for (const l of s.leaves) {
    if (!recent(l.leaveAt)) continue
    out.push({ key: `leave:${l.key}`, kind: 'leave', channel: 'leave', title: `🚗 Time to leave for ${l.title}`, body: `${l.driveMinutes} min drive to ${l.location}`, tab: 'notes' })
  }
  for (const t of s.timers) {
    if (!recent(t.endsAt)) continue
    out.push({ key: `timer:${t.id}:${t.endsAt}`, kind: 'timers', channel: 'timers', title: `⏳ ${name(t.personId)}'s ${timerTitle(t)} is up`, body: t.title && t.title !== 'Video Game Time' ? 'Time to stop' : 'Time to put the controller down', tab: 'chores' })
  }
  for (const w of s.weather) {
    out.push({ key: `weather:${w.id}`, kind: 'weather', channel: 'weather', title: `⚠️ ${w.title}`, body: w.area, tab: 'notes' })
  }
  return out
}

/** Sent-alert keys older than this are forgotten (nothing they guard can come back after that). */
export const SENT_KEEP_MS = 3 * 24 * 60 * 60_000

/** Drops expired keys from the "already sent" record. */
export function pruneSent(sent: Record<string, number>, nowMs: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, at] of Object.entries(sent)) if (nowMs - at < SENT_KEEP_MS) out[k] = at
  return out
}

/** The Android app's FCM data message for an alert (FCM data values must all be strings). */
export function fcmData(a: Pick<PushAlert, 'key' | 'kind' | 'channel' | 'title' | 'body' | 'tab' | 'silent' | 'actions'>): Record<string, string> {
  const out: Record<string, string> = {
    key: a.key,
    kind: a.kind,
    channel: a.channel,
    title: a.title,
    body: a.body,
    tab: a.tab,
    ring: a.silent ? '0' : '1'
  }
  if (a.actions?.length) out.actions = JSON.stringify(a.actions)
  return out
}
