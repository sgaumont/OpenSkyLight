import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))

import Database from 'better-sqlite3'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrations'
import { createSettingsService } from '../../src/main/services/settingsService'
import { createEventService } from '../../src/main/services/eventService'
import { createCalendarService } from '../../src/main/services/calendarService'
import { createTravelService, type RouteLookup } from '../../src/main/services/travelService'
import { calendarUpdateSchema } from '../../src/shared/ipc/schemas'

const HOUR = 3600_000

describe('arrive-by offsets (OPE-17)', () => {
  let handle: DbHandle
  beforeEach(() => {
    handle = openDatabase(':memory:')
  })
  afterEach(() => handle.sqlite.close())

  const setup = () => {
    const calendars = createCalendarService(handle.db)
    const events = createEventService(handle.db, () => 'America/Edmonton')
    const hockey = calendars.create({ name: 'Hockey', color: '#46A758' })
    const family = calendars.create({ name: 'Family', color: '#0091FF' })
    const add = (calendarId: string, title: string, start: string, allDay = false, location: string | null = null) =>
      events.create({
        calendarId,
        title,
        location,
        start,
        end: new Date(Date.parse(start) + HOUR).toISOString(),
        tz: 'America/Edmonton',
        allDay,
        personIds: []
      })
    return { calendars, events, hockey, family, add }
  }

  it('calendars default to arriving on time and keep a saved offset', () => {
    const { calendars, hockey } = setup()
    expect(hockey.arriveOffsetMinutes).toBe(0)
    expect(calendars.update({ id: hockey.id, arriveOffsetMinutes: 46 }).arriveOffsetMinutes).toBe(46)
    expect(calendars.list().find((c) => c.id === hockey.id)?.arriveOffsetMinutes).toBe(46)
  })

  it('an event shows arrive-by = start − offset; none for offset 0 or all-day events', () => {
    const { calendars, events, hockey, family, add } = setup()
    calendars.update({ id: hockey.id, arriveOffsetMinutes: 46 })
    add(hockey.id, 'Game', '2026-11-07T01:00:00Z') // 6:00 pm Edmonton
    add(hockey.id, 'Tournament', '2026-11-07T07:00:00Z', true)
    add(family.id, 'Dinner', '2026-11-07T02:00:00Z')
    const occ = events.getOccurrences({ start: '2026-11-06T00:00:00Z', end: '2026-11-09T00:00:00Z' })
    const by = (t: string) => occ.find((o) => o.title === t)!
    expect(by('Game').arriveBy).toBe('2026-11-07T00:14:00.000Z') // 5:14 pm
    expect(by('Tournament').arriveBy).toBeNull()
    expect(by('Dinner').arriveBy).toBeNull()
  })

  it('leave-by counts back from arrive-by', async () => {
    const { calendars, events, hockey, add } = setup()
    calendars.update({ id: hockey.id, arriveOffsetMinutes: 46 })
    add(hockey.id, 'Game', '2026-11-07T01:00:00Z', false, 'Tipton Arena, Edmonton')
    const settings = createSettingsService(handle.db)
    settings.set({ travel: { enabled: true, homeAddress: '123 Home St, Edmonton', bufferMinutes: 5 } })
    const lookup = vi.fn<RouteLookup>(async () => 18)
    const travel = createTravelService({ settings, events, onChange: () => {}, lookup, now: () => Date.parse('2026-11-06T20:00:00Z') })
    travel.setApiKey('AIza-test-key-0123456789abcdef')
    await travel.refresh()
    const [t] = travel.leaveTimes()
    expect(t.arriveBy).toBe('2026-11-07T00:14:00.000Z')
    // 5:14 − 18 min drive − 5 min buffer = 4:51 pm
    expect(t.leaveAt).toBe('2026-11-06T23:51:00.000Z')
    // the first lookup asks about leaving in time for 5:14 (30 min first guess + 5 buffer → 4:39), not the 6:00 start
    expect(lookup.mock.calls[0][3]).toBe(Date.parse('2026-11-06T23:39:00Z'))
  })

  it('the update schema allows 0–240 minutes', () => {
    expect(calendarUpdateSchema.safeParse({ id: 'c', arriveOffsetMinutes: 46 }).success).toBe(true)
    expect(calendarUpdateSchema.safeParse({ id: 'c', arriveOffsetMinutes: -5 }).success).toBe(false)
    expect(calendarUpdateSchema.safeParse({ id: 'c', arriveOffsetMinutes: 300 }).success).toBe(false)
  })

  it('a v8 database upgrades to v9: existing calendars arrive on time', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, 8)
    sqlite.exec(`INSERT INTO calendars (id, name) VALUES ('c1','Old')`)
    runMigrations(sqlite, 9)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(9)
    expect(sqlite.prepare('SELECT arrive_offset_min AS m FROM calendars').get()).toEqual({ m: 0 })
    sqlite.close()
  })
})
