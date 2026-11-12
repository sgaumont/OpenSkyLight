import { eq } from 'drizzle-orm'
import { DateTime } from 'luxon'
import webpush from 'web-push'
import type { AppDb } from '../db/client'
import { pushSubscriptions } from '../db/schema'
import type { SettingsService } from './settingsService'
import { uuidv7 } from '@shared/uuid'
import { isoUtc } from '@shared/dates'
import { dueAlerts, fcmData, NO_PUSH, pruneSent, PUSH_KINDS, type PushAlert, type PushPrefs, type PushState } from '@shared/pushAlerts'
import { invalid } from './errors'
import type { FcmSender } from './fcmSender'

const KEY_VAPID = 'push.vapid' // { publicKey, privateKey }
const KEY_SENT = 'push.sent' // { [alertKey]: sentAtMs }
/** Web Push wants a contact for the sender; the project page will do. */
const VAPID_SUBJECT = 'https://github.com/sgaumont/OpenSkyLight'
/** How often time-based alerts (leave by, game timers, weather) are checked. */
const TICK_MS = 30_000

export interface PushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
  personId: string | null
  prefs: PushPrefs
}

/** The Android app's sign-up: its FCM token instead of a Web Push address. */
export interface FcmSubscriptionInput {
  token: string
  personId: string | null
  prefs: PushPrefs
  deviceName?: string | null
}

const FCM_PREFIX = 'fcm:'

/** Hands one notification to the phone's push service; throws with `statusCode` on failure. */
export type PushSender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  vapid: { publicKey: string; privateKey: string }
) => Promise<unknown>

const webPushSender: PushSender = (sub, payload, vapid) =>
  webpush.sendNotification(sub, payload, {
    TTL: 15 * 60,
    urgency: 'high',
    vapidDetails: { subject: VAPID_SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey }
  })

/** Where the alerts come from; all read-only. */
export interface NotifySources {
  names(): Map<string, string>
  chat(): PushState['chat']
  approvals(today: string): PushState['approvals']
  /** Shop purchases waiting for a parent */
  requests?(): NonNullable<PushState['requests']>
  leaves(): PushState['leaves']
  timers(): PushState['timers']
  weather(): Promise<PushState['weather']>
}

/**
 * Phone notifications over Web Push: phones subscribe (from the secure Tailscale address) and
 * pick which alerts they want; the kiosk sends each alert once. Chat and approvals are checked
 * whenever that data changes, the time-based ones every 30 seconds.
 */
export function createNotifyService(deps: {
  db: AppDb
  settings: SettingsService
  sources: NotifySources
  deviceTz: () => string
  send?: PushSender
  /** the FCM sender, or null while there's no service-account key (Android phones are then skipped) */
  fcm?: () => FcmSender | null
  now?: () => number
}) {
  const { db, settings, sources } = deps
  const send = deps.send ?? webPushSender
  const fcm = deps.fcm ?? (() => null)
  const now = deps.now ?? Date.now
  let timer: NodeJS.Timeout | null = null
  let checking: Promise<void> = Promise.resolve()

  function vapid(): { publicKey: string; privateKey: string } {
    const raw = settings.getRaw(KEY_VAPID)
    if (raw) return JSON.parse(raw)
    const keys = webpush.generateVAPIDKeys()
    settings.setRaw(KEY_VAPID, JSON.stringify(keys))
    return keys
  }

  const readPrefs = (json: string): PushPrefs => ({ ...NO_PUSH, ...(JSON.parse(json) as Partial<PushPrefs>) })

  function get(endpoint: string): { personId: string | null; prefs: PushPrefs } | null {
    const [row] = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).all()
    return row ? { personId: row.personId, prefs: readPrefs(row.prefs) } : null
  }

  /** Adds this phone, or updates who it is and what it wants. */
  function subscribe(input: PushSubscriptionInput): void {
    if (!/^https:\/\//.test(input.endpoint)) throw invalid('Not a push address')
    const prefs = JSON.stringify(Object.fromEntries(PUSH_KINDS.map((k) => [k, input.prefs[k] === true])))
    const existing = get(input.endpoint)
    if (existing) {
      db.update(pushSubscriptions)
        .set({ p256dh: input.p256dh, auth: input.auth, personId: input.personId, prefs })
        .where(eq(pushSubscriptions.endpoint, input.endpoint))
        .run()
    } else {
      db.insert(pushSubscriptions)
        .values({ id: uuidv7(), endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, personId: input.personId, prefs, createdAt: isoUtc(DateTime.utc()) })
        .run()
    }
  }

  /** Adds the Android app's phone (or updates it); its endpoint is "fcm:<token>". */
  function subscribeFcm(input: FcmSubscriptionInput): { endpoint: string } {
    const endpoint = FCM_PREFIX + input.token
    const prefs = JSON.stringify(Object.fromEntries(PUSH_KINDS.map((k) => [k, input.prefs[k] === true])))
    const deviceName = input.deviceName?.trim() || null
    if (get(endpoint)) {
      db.update(pushSubscriptions).set({ personId: input.personId, prefs, deviceName }).where(eq(pushSubscriptions.endpoint, endpoint)).run()
    } else {
      db.insert(pushSubscriptions)
        .values({ id: uuidv7(), endpoint, kind: 'fcm', p256dh: '', auth: '', personId: input.personId, deviceName, prefs, createdAt: isoUtc(DateTime.utc()) })
        .run()
    }
    return { endpoint }
  }

  function unsubscribe(endpoint: string): void {
    db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run()
  }

  /** Sends to every phone that wants this kind of alert; drops phones the push service says are gone. */
  async function deliver(
    alert: Pick<PushAlert, 'kind' | 'channel' | 'title' | 'body' | 'tab' | 'skipPersonId' | 'skipEndpoint' | 'silent' | 'key' | 'actions'>,
    only?: string
  ): Promise<number> {
    const payload = JSON.stringify({ title: alert.title, body: alert.body, tag: alert.key, url: `/?tab=${alert.tab}`, silent: alert.silent === true })
    let fcmSend: FcmSender | null | undefined
    let delivered = 0
    for (const row of db.select().from(pushSubscriptions).all()) {
      if (only ? row.endpoint !== only : !readPrefs(row.prefs)[alert.kind]) continue
      if (!only && alert.skipPersonId && row.personId === alert.skipPersonId) continue
      if (!only && alert.skipEndpoint && row.endpoint === alert.skipEndpoint) continue
      try {
        if (row.kind === 'fcm') {
          // no key yet (the Firebase project isn't set up): the Android phones just miss out
          if (fcmSend === undefined) fcmSend = fcm()
          if (!fcmSend) continue
          await fcmSend({ token: row.endpoint.slice(FCM_PREFIX.length), data: fcmData(alert) })
        } else {
          await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, vapid())
        }
        delivered++
      } catch (e) {
        const err = e as { statusCode?: number; gone?: boolean }
        // Web Push 404 / 410: the phone unsubscribed or the browser data was cleared;
        // FCM `gone`: the app was uninstalled or its token replaced
        if (row.kind === 'fcm' ? err.gone : err.statusCode === 404 || err.statusCode === 410) unsubscribe(row.endpoint)
        else console.warn('[notify] push failed', err.statusCode ?? (e as Error).message)
      }
    }
    return delivered
  }

  /** A "this works" notification to one phone. */
  async function test(endpoint: string): Promise<{ delivered: boolean }> {
    if (!get(endpoint)) throw invalid('Turn notifications on first')
    const n = await deliver({ key: `test:${now()}`, kind: 'chat', channel: 'chat_ring', title: '🔔 OpenSkyLight', body: 'Notifications are working on this phone.', tab: 'notes' }, endpoint)
    return { delivered: n > 0 }
  }

  function readSent(): Record<string, number> {
    try {
      return JSON.parse(settings.getRaw(KEY_SENT) ?? '{}')
    } catch {
      return {}
    }
  }

  async function gather(): Promise<PushState> {
    const today = DateTime.fromMillis(now()).setZone(deps.deviceTz()).toISODate()!
    return {
      nowMs: now(),
      names: sources.names(),
      chat: sources.chat(),
      approvals: sources.approvals(today),
      requests: sources.requests?.() ?? [],
      leaves: sources.leaves(),
      timers: sources.timers(),
      weather: await sources.weather().catch(() => [])
    }
  }

  /**
   * Sends whatever is due and not sent yet. `quiet` records it all as sent without sending —
   * at start-up, so things that were already there (approvals, warnings) don't all buzz at once.
   */
  async function runCheck(quiet: boolean): Promise<void> {
    const state = await gather()
    const sent = pruneSent(readSent(), state.nowMs)
    const fresh = dueAlerts(state).filter((a) => !(a.key in sent))
    for (const a of fresh) sent[a.key] = state.nowMs
    settings.setRaw(KEY_SENT, JSON.stringify(sent))
    if (quiet) return
    for (const a of fresh) await deliver(a)
  }

  /** Checks now (one check at a time). */
  function check(quiet = false): Promise<void> {
    checking = checking.then(() => runCheck(quiet)).catch((e) => console.warn('[notify] check failed', e))
    return checking
  }

  function start(): void {
    void check(true)
    timer = setInterval(() => void check(), TICK_MS)
    timer.unref()
  }

  function stop(): void {
    if (timer) clearInterval(timer)
    timer = null
  }

  return {
    publicKey: () => ({ publicKey: vapid().publicKey }),
    get,
    subscribe,
    subscribeFcm,
    unsubscribe,
    test,
    check,
    start,
    stop
  }
}

export type NotifyService = ReturnType<typeof createNotifyService>
