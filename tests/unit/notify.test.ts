import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrations'
import { createSettingsService } from '../../src/main/services/settingsService'
import { createNotifyService, type NotifySources } from '../../src/main/services/notifyService'
import { dueAlerts, NO_PUSH, pruneSent, SENT_KEEP_MS, STALE_MS, type PushState } from '../../src/shared/pushAlerts'
import { parseTailscale } from '../../src/main/companion/tailscaleHttps'

const NOW = Date.parse('2026-11-05T18:00:00Z')
const ago = (min: number): string => new Date(NOW - min * 60_000).toISOString()

function state(over: Partial<PushState> = {}): PushState {
  return { nowMs: NOW, names: new Map([['ava', 'Ava'], ['mum', 'Mum']]), chat: [], approvals: [], leaves: [], timers: [], weather: [], ...over }
}

describe('push alert rules', () => {
  it('chat: names the sender, skips the sender\'s own phone, ignores old messages', () => {
    const alerts = dueAlerts(
      state({
        chat: [
          { id: 'm1', text: 'Dinner at 6', authorId: 'mum', fromKiosk: false, createdAt: ago(1) },
          { id: 'm2', text: '👍', authorId: null, fromKiosk: true, createdAt: ago(0) },
          { id: 'm3', text: 'old', authorId: 'mum', fromKiosk: false, createdAt: ago(STALE_MS / 60_000 + 1) }
        ]
      })
    )
    expect(alerts.map((a) => [a.title, a.skipPersonId])).toEqual([
      ['💬 Mum', 'mum'],
      ['💬 Tablet', null]
    ])
  })

  it('leave-by and game timers fire once their time comes, not before and not long after', () => {
    const leave = (key: string, min: number) => ({ key, title: 'Hockey', location: 'Arena', leaveAt: ago(min), driveMinutes: 12 })
    const alerts = dueAlerts(
      state({
        leaves: [leave('now', 0), leave('soon', -5), leave('missed', 30)],
        timers: [{ id: 't1', personId: 'ava', endsAt: ago(1) }]
      })
    )
    expect(alerts.map((a) => a.title)).toEqual(['🚗 Time to leave for Hockey', "⏳ Ava's Video Game Time is up"])
    expect(alerts[0].body).toBe('12 min drive to Arena')
  })

  it('approvals and weather warnings each have a stable once-only key', () => {
    const s = state({
      approvals: [{ checklistId: 'vg', title: 'Video Games', personId: 'ava', date: '2026-11-05', kind: 'videogames', round: 2 }],
      weather: [{ id: 'w1', title: 'Snowfall warning', area: 'Calgary' }]
    })
    const [a, w] = dueAlerts(s)
    expect(a).toMatchObject({ key: 'approve:vg:ava:2026-11-05:2', title: '⭐ Ava finished Video Games (round 2)', tab: 'chores' })
    expect(w).toMatchObject({ key: 'weather:w1', kind: 'weather', title: '⚠️ Snowfall warning' })
    expect(dueAlerts(s).map((x) => x.key)).toEqual([a.key, w.key])
  })

  it('forgets sent keys after a few days', () => {
    expect(pruneSent({ old: NOW - SENT_KEEP_MS, recent: NOW - 1000 }, NOW)).toEqual({ recent: NOW - 1000 })
  })
})

describe('notify service', () => {
  let handle: DbHandle
  let sent: { endpoint: string; payload: { title: string; url: string } }[]
  let fail: Record<string, number>
  let sources: NotifySources
  let chat: PushState['chat']
  let clock: number
  beforeEach(() => {
    handle = openDatabase(':memory:')
    sent = []
    fail = {}
    chat = []
    clock = NOW
    sources = {
      names: () => new Map([['mum', 'Mum']]),
      chat: () => chat,
      approvals: () => [],
      leaves: () => [],
      timers: () => [],
      weather: async () => []
    }
  })
  afterEach(() => handle.sqlite.close())

  const service = () =>
    createNotifyService({
      db: handle.db,
      settings: createSettingsService(handle.db),
      sources,
      deviceTz: () => 'America/Edmonton',
      now: () => clock,
      send: async (sub, payload) => {
        if (fail[sub.endpoint]) throw Object.assign(new Error('gone'), { statusCode: fail[sub.endpoint] })
        sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) })
      }
    })
  const phone = (n: string, personId: string | null, chatOn: boolean) => ({
    endpoint: `https://push.example/${n}`,
    p256dh: 'k',
    auth: 'a',
    personId,
    prefs: { ...NO_PUSH, chat: chatOn }
  })

  it('every alert is off until a phone opts in; subscribing again updates it', () => {
    const svc = service()
    svc.subscribe(phone('a', null, false))
    expect(svc.get('https://push.example/a')).toEqual({ personId: null, prefs: NO_PUSH })
    svc.subscribe(phone('a', 'mum', true))
    expect(svc.get('https://push.example/a')).toEqual({ personId: 'mum', prefs: { ...NO_PUSH, chat: true } })
    expect(svc.publicKey().publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/)
  })

  it('sends a new message once, to the phones that want chat, but not the sender\'s own', async () => {
    const svc = service()
    svc.subscribe(phone('mum', 'mum', true))
    svc.subscribe(phone('dad', 'dad', true))
    svc.subscribe(phone('kid', 'ava', false))
    await svc.check(true) // start-up: nothing yet
    chat = [{ id: 'm1', text: 'Home by 6', authorId: 'mum', fromKiosk: false, createdAt: new Date(clock).toISOString() }]
    await svc.check()
    await svc.check()
    expect(sent.map((s) => [s.endpoint, s.payload.title, s.payload.url])).toEqual([['https://push.example/dad', '💬 Mum', '/?tab=notes']])
  })

  it('stays quiet about what was already there at start-up', async () => {
    chat = [{ id: 'm0', text: 'earlier', authorId: null, fromKiosk: true, createdAt: new Date(clock).toISOString() }]
    const svc = service()
    svc.subscribe(phone('dad', 'dad', true))
    await svc.check(true)
    await svc.check()
    expect(sent).toEqual([])
  })

  it('drops a phone the push service says is gone; sends a test to one phone', async () => {
    const svc = service()
    svc.subscribe(phone('gone', null, true))
    svc.subscribe(phone('ok', null, false))
    fail['https://push.example/gone'] = 410
    await svc.check(true)
    chat = [{ id: 'm1', text: 'hi', authorId: null, fromKiosk: true, createdAt: new Date(clock).toISOString() }]
    await svc.check()
    expect(svc.get('https://push.example/gone')).toBeNull()
    expect(await svc.test('https://push.example/ok')).toEqual({ delivered: true })
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push.example/ok'])
  })
})

describe('Tailscale https address', () => {
  const status = (state: string, dns = 'surface.tail1234.ts.net.', certs: string[] | null = ['surface.tail1234.ts.net']) =>
    JSON.stringify({ BackendState: state, Self: { DNSName: dns }, CertDomains: certs })
  const serve = (port: number) =>
    JSON.stringify({ TCP: { '443': { HTTPS: true } }, Web: { 'surface.tail1234.ts.net:443': { Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } } } })

  it('reads the name, the certificates and whether serve forwards to the companion port', () => {
    expect(parseTailscale(status('Running'), serve(8420), 8420)).toEqual({ host: 'surface.tail1234.ts.net', certs: true, serving: true })
    expect(parseTailscale(status('Running'), serve(9000), 8420)).toMatchObject({ serving: false })
    expect(parseTailscale(status('Running', 'surface.tail1234.ts.net.', null), '{}', 8420)).toEqual({ host: 'surface.tail1234.ts.net', certs: false, serving: false })
    expect(parseTailscale(status('Stopped'), '', 8420)).toEqual({ host: null, certs: false, serving: false })
    expect(parseTailscale('not json', '', 8420)).toEqual({ host: null, certs: false, serving: false })
  })
})

describe('database v11', () => {
  it('a v10 database upgrades with an empty push_subscriptions table', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, 10)
    runMigrations(sqlite, 11)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(11)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 })
    sqlite.close()
  })
})
