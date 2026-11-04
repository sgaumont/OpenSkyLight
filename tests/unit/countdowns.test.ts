import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrations'
import { createCountdownsService } from '../../src/main/services/countdownsService'
import { countdownLabel, daysUntil } from '../../src/shared/countdown'
import { COMPANION_CHANNELS } from '../../src/shared/ipc/companionChannels'

describe('countdown wording', () => {
  it('days, tomorrow, today, gone', () => {
    expect(daysUntil('2026-12-25', '2026-11-04')).toBe(51)
    expect(countdownLabel('2026-12-25', '2026-11-04')).toBe('51 days')
    expect(countdownLabel('2026-11-06', '2026-11-04')).toBe('2 days')
    expect(countdownLabel('2026-11-05', '2026-11-04')).toBe('Tomorrow')
    expect(countdownLabel('2026-11-04', '2026-11-04')).toBe('Today!')
    expect(countdownLabel('2026-11-03', '2026-11-04')).toBeNull()
    // across a daylight-saving change and a month end
    expect(daysUntil('2027-03-20', '2027-03-10')).toBe(10)
  })
})

describe('countdowns service', () => {
  let handle: DbHandle
  let today = '2026-11-04'
  beforeEach(() => {
    handle = openDatabase(':memory:')
    today = '2026-11-04'
  })
  afterEach(() => handle.sqlite.close())
  const svc = () => createCountdownsService(handle.db, () => 'America/Regina', () => today)

  it('lists today and future ones, soonest first', () => {
    const s = svc()
    s.create({ title: 'Christmas', emoji: '🎄', date: '2026-12-25' })
    s.create({ title: "Rachel's birthday", emoji: '🎂', date: '2026-11-09' })
    s.create({ title: 'Today thing', emoji: null, date: '2026-11-04' })
    expect(s.list().map((c) => c.title)).toEqual(['Today thing', "Rachel's birthday", 'Christmas'])
    today = '2026-11-10'
    expect(s.list().map((c) => c.title)).toEqual(['Christmas']) // past days drop off
  })

  it('edits and deletes; refuses a blank name or a past day', () => {
    const s = svc()
    const c = s.create({ title: 'Trip', emoji: '✈️', date: '2026-12-01' })
    expect(s.update({ id: c.id, title: '  Ski trip ', emoji: '🏖️', date: '2026-12-02' })).toEqual({ id: c.id, title: 'Ski trip', emoji: '🏖️', date: '2026-12-02' })
    s.remove(c.id)
    expect(s.list()).toEqual([])
    expect(() => s.create({ title: '  ', emoji: null, date: '2026-12-01' })).toThrow()
    expect(() => s.create({ title: 'Yesterday', emoji: null, date: '2026-11-03' })).toThrow()
  })

  it('a paired phone may list, add, change and delete countdowns', () => {
    for (const c of ['countdowns:list', 'countdowns:create', 'countdowns:update', 'countdowns:delete'] as const) {
      expect(COMPANION_CHANNELS.has(c), c).toBe(true)
    }
  })

  it('a v6 database upgrades to v7 with an empty countdowns table', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, 6)
    runMigrations(sqlite)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(7)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM countdowns').get()).toEqual({ n: 0 })
    sqlite.close()
  })
})

describe('home tile types', () => {
  it('settings accept every tile type the app knows (a new tile must be added to the schema too)', async () => {
    const { settingsPatchSchema } = await import('../../src/shared/ipc/schemas')
    const { TILE_SPECS } = await import('../../src/shared/home')
    for (const type of Object.keys(TILE_SPECS)) {
      const res = settingsPatchSchema.safeParse({ patch: { homeLayout: [{ id: 't', type, x: 0, y: 0, w: 3, h: 3 }] } })
      expect(res.success, type).toBe(true)
    }
  })
})
