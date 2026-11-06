import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { DateTime } from 'luxon'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrations'
import { createSettingsService } from '../../src/main/services/settingsService'
import { createNotesService } from '../../src/main/services/notesService'
import { createNotifyService, type NotifySources } from '../../src/main/services/notifyService'
import { dueAlerts, NO_PUSH, type PushState } from '../../src/shared/pushAlerts'

const NOW = Date.parse('2026-11-06T18:00:00Z')
const iso = new Date(NOW).toISOString()

describe('chat Ring / Quiet and phone names', () => {
  let handle: DbHandle
  let clock = NOW
  beforeEach(() => {
    handle = openDatabase(':memory:')
    clock = NOW
  })
  afterEach(() => handle.sqlite.close())
  // a minute apart, so the messages keep their order
  const notes = () => createNotesService(handle.db, () => 'America/Edmonton', () => DateTime.fromMillis((clock += 60_000), { zone: 'utc' }))

  it('a phone message is Quiet unless sent with Ring; the tablet always rings', () => {
    const chat = notes()
    chat.send({ text: 'quiet one', deviceName: "Sean's phone" }, false)
    chat.send({ text: 'loud one', ring: true, deviceName: "Sean's phone" }, false)
    chat.send({ text: 'from the tablet', ring: false }, true)
    const t = chat.timeline()
    expect(t.map((m) => [m.text, m.ring, m.deviceName])).toEqual([
      ['quiet one', false, "Sean's phone"],
      ['loud one', true, "Sean's phone"],
      ['from the tablet', true, null]
    ])
  })

  it("the sender's push endpoint is kept for notifications but never sent to a page", () => {
    const chat = notes()
    chat.send({ text: 'hi', endpoint: 'https://push.example/sean' }, false)
    expect(chat.pushFeed()[0].senderEndpoint).toBe('https://push.example/sean')
    expect('senderEndpoint' in chat.timeline()[0]).toBe(false)
  })

  it('alert rule: named by the phone, silent when Quiet, skips the sending phone', () => {
    const s: PushState = {
      nowMs: NOW,
      names: new Map(),
      approvals: [],
      leaves: [],
      timers: [],
      weather: [],
      chat: [
        { id: 'q', text: 'quiet', authorId: null, fromKiosk: false, createdAt: iso, ring: false, deviceName: "Sean's phone", senderEndpoint: 'E1' },
        { id: 'r', text: 'loud', authorId: null, fromKiosk: false, createdAt: iso, ring: true, deviceName: null, senderEndpoint: 'E2' },
        { id: 't', text: 'tablet', authorId: null, fromKiosk: true, createdAt: iso, ring: true }
      ]
    }
    const a = dueAlerts(s)
    expect(a.map((x) => [x.title, x.silent, x.skipEndpoint])).toEqual([
      ["💬 Sean's phone", true, 'E1'],
      ['💬 Phone', false, 'E2'],
      ['💬 Tablet', false, null]
    ])
  })

  it('notify service: Quiet arrives silent, Ring with sound, never on the sending phone', async () => {
    const sent: { endpoint: string; payload: { title: string; silent: boolean } }[] = []
    let chat: PushState['chat'] = []
    const sources: NotifySources = {
      names: () => new Map(),
      chat: () => chat,
      approvals: () => [],
      leaves: () => [],
      timers: () => [],
      weather: async () => []
    }
    const svc = createNotifyService({
      db: handle.db,
      settings: createSettingsService(handle.db),
      sources,
      deviceTz: () => 'America/Edmonton',
      now: () => NOW,
      send: async (sub, payload) => {
        sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) })
      }
    })
    for (const n of ['sean', 'wife']) svc.subscribe({ endpoint: `https://push.example/${n}`, p256dh: 'k', auth: 'a', personId: null, prefs: { ...NO_PUSH, chat: true } })
    await svc.check(true)
    chat = [
      { id: 'q', text: 'quiet', authorId: null, fromKiosk: false, createdAt: iso, ring: false, deviceName: "Sean's phone", senderEndpoint: 'https://push.example/sean' },
      { id: 'r', text: 'loud', authorId: null, fromKiosk: false, createdAt: iso, ring: true, deviceName: "Sean's phone", senderEndpoint: 'https://push.example/sean' },
      { id: 't', text: 'tablet', authorId: null, fromKiosk: true, createdAt: iso, ring: true }
    ]
    await svc.check()
    expect(sent.map((s) => [s.endpoint.split('/').pop(), s.payload.title, s.payload.silent])).toEqual([
      ['wife', "💬 Sean's phone", true],
      ['wife', "💬 Sean's phone", false],
      ['sean', '💬 Tablet', false],
      ['wife', '💬 Tablet', false]
    ])
  })

  it('a v11 database upgrades to v12: existing messages rang, with no phone name', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, 11)
    sqlite.exec(`INSERT INTO notes (id, text, created_at) VALUES ('n1','Hi','2026-11-01T00:00:00Z')`)
    runMigrations(sqlite, 12)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(12)
    expect(sqlite.prepare('SELECT ring, device_name AS d, sender_endpoint AS e FROM notes').get()).toEqual({ ring: 1, d: null, e: null })
    sqlite.close()
  })
})
