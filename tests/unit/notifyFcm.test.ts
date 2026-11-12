import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrations'
import { createSettingsService } from '../../src/main/services/settingsService'
import { createNotifyService, type NotifySources } from '../../src/main/services/notifyService'
import { createFcm, fcmTokenGone, type FcmMessage, type FcmPost } from '../../src/main/services/fcmSender'
import { dueAlerts, fcmData, NO_PUSH, type PushState } from '../../src/shared/pushAlerts'

const NOW = Date.parse('2026-11-12T18:00:00Z')
const at = new Date(NOW).toISOString()
const TOKEN = 'dGVzdC10b2tlbi1mb3ItZmNt:APA91b_example'

function state(over: Partial<PushState> = {}): PushState {
  return { nowMs: NOW, names: new Map([['ava', 'Ava'], ['mum', 'Mum']]), chat: [], approvals: [], leaves: [], timers: [], weather: [], ...over }
}

describe('Android alert channels and buttons', () => {
  it('chat rings or goes quiet, and offers a reply', () => {
    const [ring, quiet] = dueAlerts(
      state({
        chat: [
          { id: 'm1', text: 'Dinner!', authorId: 'mum', fromKiosk: false, createdAt: at },
          { id: 'm2', text: 'shh', authorId: 'mum', fromKiosk: false, createdAt: at, ring: false }
        ]
      })
    )
    expect(ring.channel).toBe('chat_ring')
    expect(quiet.channel).toBe('chat_quiet')
    expect(fcmData(quiet)).toMatchObject({ ring: '0', channel: 'chat_quiet', tab: 'notes', key: 'chat:m2' })
    expect(JSON.parse(fcmData(ring).actions)).toEqual([{ id: 'reply', label: 'Reply', rpc: 'chat:send', req: {}, input: 'text' }])
  })

  it('a Shop request has OK / No; a finished chore set has Approve with its round', () => {
    const [chore, shop] = dueAlerts(
      state({
        approvals: [{ checklistId: 'vg', title: 'Video Games', personId: 'ava', date: '2026-11-12', kind: 'videogames', round: 2 }],
        requests: [{ id: 'r1', personId: 'ava', rewardTitle: 'Small toy', starsSpent: 6, minutes: null, currency: 'coins' }]
      })
    )
    expect(chore.channel).toBe('approvals')
    expect(chore.actions).toEqual([
      { id: 'approve', label: 'Approve', rpc: 'chores:approveUnlock', req: { checklistId: 'vg', personId: 'ava', date: '2026-11-12', round: 2 } }
    ])
    expect(shop.channel).toBe('shop')
    expect(shop.actions?.map((a) => [a.rpc, a.req])).toEqual([
      ['rewards:grant', { redemptionId: 'r1' }],
      ['rewards:deny', { redemptionId: 'r1' }]
    ])
  })

  it('timers, leave-by and weather have their own channels and no buttons; every data value is a string', () => {
    const alerts = dueAlerts(
      state({
        timers: [{ id: 't1', personId: 'ava', endsAt: at }],
        leaves: [{ key: 'l1', title: 'Hockey', location: 'Arena', leaveAt: at, driveMinutes: 12 }],
        weather: [{ id: 'w1', title: 'Snowfall warning', area: 'Calgary' }]
      })
    )
    expect(alerts.map((a) => [a.channel, a.actions])).toEqual([
      ['leave', undefined],
      ['timers', undefined],
      ['weather', undefined]
    ])
    for (const a of alerts) {
      const d = fcmData(a)
      expect(Object.values(d).every((v) => typeof v === 'string')).toBe(true)
      expect(d.ring).toBe('1')
      expect(d).not.toHaveProperty('actions')
    }
  })
})

describe('notify service: Android phones', () => {
  let handle: DbHandle
  let web: string[]
  let fcmSent: FcmMessage[]
  let fcmFail: { statusCode: number; gone: boolean } | null
  let fcmOn: boolean
  let chat: PushState['chat']
  let sources: NotifySources
  beforeEach(() => {
    handle = openDatabase(':memory:')
    web = []
    fcmSent = []
    fcmFail = null
    fcmOn = true
    chat = []
    sources = { names: () => new Map([['mum', 'Mum']]), chat: () => chat, approvals: () => [], leaves: () => [], timers: () => [], weather: async () => [] }
  })
  afterEach(() => handle.sqlite.close())

  const service = () =>
    createNotifyService({
      db: handle.db,
      settings: createSettingsService(handle.db),
      sources,
      deviceTz: () => 'America/Edmonton',
      now: () => NOW,
      send: async (sub) => {
        web.push(sub.endpoint)
      },
      fcm: () =>
        fcmOn
          ? async (m) => {
              if (fcmFail) throw Object.assign(new Error('fcm'), fcmFail)
              fcmSent.push(m)
            }
          : null
    })
  const newMessage = (authorId: string | null = null) => {
    chat = [{ id: 'm1', text: 'Home by 6', authorId, fromKiosk: authorId === null, createdAt: at }]
  }

  it('signs up with its token, is reachable as "fcm:<token>", and gets data messages', async () => {
    const svc = service()
    expect(svc.subscribeFcm({ token: TOKEN, personId: 'dad', prefs: { ...NO_PUSH, chat: true }, deviceName: " Dad's Pixel " })).toEqual({ endpoint: `fcm:${TOKEN}` })
    svc.subscribe({ endpoint: 'https://push.example/pwa', p256dh: 'k', auth: 'a', personId: 'mum', prefs: { ...NO_PUSH, chat: true } })
    expect(svc.get(`fcm:${TOKEN}`)).toEqual({ personId: 'dad', prefs: { ...NO_PUSH, chat: true } })
    const [row] = handle.sqlite.prepare("SELECT kind, device_name FROM push_subscriptions WHERE endpoint LIKE 'fcm:%'").all() as { kind: string; device_name: string }[]
    expect(row).toEqual({ kind: 'fcm', device_name: "Dad's Pixel" })
    await svc.check(true)
    newMessage()
    await svc.check()
    expect(web).toEqual(['https://push.example/pwa'])
    expect(fcmSent).toHaveLength(1)
    expect(fcmSent[0].token).toBe(TOKEN)
    expect(fcmSent[0].data).toMatchObject({ key: 'chat:m1', kind: 'chat', channel: 'chat_ring', title: '💬 Tablet', body: 'Home by 6', tab: 'notes', ring: '1' })
  })

  it('its own chat message is not sent back to it (chat:send endpoint "fcm:<token>")', async () => {
    const svc = service()
    svc.subscribeFcm({ token: TOKEN, personId: null, prefs: { ...NO_PUSH, chat: true } })
    await svc.check(true)
    chat = [{ id: 'm1', text: 'hi', authorId: null, fromKiosk: false, createdAt: at, senderEndpoint: `fcm:${TOKEN}` }]
    await svc.check()
    expect(fcmSent).toEqual([])
  })

  it('without a Firebase key the Android phones are skipped and Web Push still goes', async () => {
    fcmOn = false
    const svc = service()
    svc.subscribeFcm({ token: TOKEN, personId: null, prefs: { ...NO_PUSH, chat: true } })
    svc.subscribe({ endpoint: 'https://push.example/pwa', p256dh: 'k', auth: 'a', personId: null, prefs: { ...NO_PUSH, chat: true } })
    await svc.check(true)
    newMessage()
    await svc.check()
    expect(web).toEqual(['https://push.example/pwa'])
    expect(svc.get(`fcm:${TOKEN}`)).not.toBeNull()
    expect(await svc.test(`fcm:${TOKEN}`)).toEqual({ delivered: false })
  })

  it('a dead token is dropped; any other FCM failure keeps the phone', async () => {
    const svc = service()
    svc.subscribeFcm({ token: TOKEN, personId: null, prefs: { ...NO_PUSH, chat: true } })
    fcmFail = { statusCode: 500, gone: false }
    expect(await svc.test(`fcm:${TOKEN}`)).toEqual({ delivered: false })
    expect(svc.get(`fcm:${TOKEN}`)).not.toBeNull()
    fcmFail = { statusCode: 404, gone: true }
    await svc.test(`fcm:${TOKEN}`)
    expect(svc.get(`fcm:${TOKEN}`)).toBeNull()
  })
})

describe('FCM sender', () => {
  const dir = mkdtempSync(join(tmpdir(), 'osl-fcm-'))
  const keyFile = join(dir, 'fcm-service-account.json')

  it('is off until the key file is there, then posts an HTTP v1 data message', async () => {
    const posts: { url: string; token: string; body: unknown }[] = []
    const post: FcmPost = async (url, token, body) => {
      posts.push({ url, token, body })
      return { status: 200, json: {} }
    }
    const fcm = createFcm(keyFile, { post, token: async () => 'access-1' })
    expect(fcm.sender()).toBeNull()
    writeFileSync(keyFile, 'not json')
    expect(fcm.sender()).toBeNull()
    writeFileSync(keyFile, JSON.stringify({ project_id: 'osl-family', client_email: 'x@osl-family.iam.gserviceaccount.com', private_key: 'k' }))
    await fcm.sender()!({ token: TOKEN, data: { title: 'Hi' } })
    expect(posts).toEqual([
      {
        url: 'https://fcm.googleapis.com/v1/projects/osl-family/messages:send',
        token: 'access-1',
        body: { message: { token: TOKEN, data: { title: 'Hi' }, android: { priority: 'HIGH', ttl: '900s' } } }
      }
    ])
  })

  it('a failed send throws with the status, and says when the token is gone', async () => {
    writeFileSync(keyFile, JSON.stringify({ project_id: 'p', client_email: 'e', private_key: 'k' }))
    const fcm = createFcm(keyFile, {
      post: async () => ({ status: 400, json: { error: { details: [{ errorCode: 'UNREGISTERED' }] } } }),
      token: async () => 't'
    })
    await expect(fcm.sender()!({ token: TOKEN, data: {} })).rejects.toMatchObject({ statusCode: 400, gone: true })
    expect(fcmTokenGone(404, null)).toBe(true)
    expect(fcmTokenGone(400, { error: { details: [{ errorCode: 'INVALID_ARGUMENT' }] } })).toBe(false)
    expect(fcmTokenGone(503, null)).toBe(false)
  })
})

describe('database v16', () => {
  it('a v15 database keeps its Web Push phones, now marked webpush', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, 15)
    sqlite
      .prepare("INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, person_id, prefs, created_at) VALUES ('s1', 'https://push.example/a', 'k', 'a', NULL, '{}', '2026-11-01T00:00:00Z')")
      .run()
    runMigrations(sqlite, 16)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(16)
    expect(sqlite.prepare('SELECT kind, device_name FROM push_subscriptions').get()).toEqual({ kind: 'webpush', device_name: null })
    sqlite.close()
  })
})
