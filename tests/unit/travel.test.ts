import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// the travel service encrypts its API key with Electron's OS key store; in tests, store it plain
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))

import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { createSettingsService } from '../../src/main/services/settingsService'
import { createEventService } from '../../src/main/services/eventService'
import { createCalendarService } from '../../src/main/services/calendarService'
import { createTravelService, type RouteLookup } from '../../src/main/services/travelService'
import {
  DAILY_CALL_CAP,
  departureFor,
  durationToMinutes,
  isRoutableLocation,
  leaveAtMs,
  refreshDue
} from '../../src/shared/travel'
import { settingsPatchSchema } from '../../src/shared/ipc/schemas'

const MIN = 60_000
const HOUR = 60 * MIN

describe('which locations get a drive time', () => {
  it('real places yes, online meetings and a bare city no', () => {
    expect(isRoutableLocation('2051 Leger Rd Edmonton AB T6R 0R9 Canada', 'Edmonton')).toBe(true)
    expect(isRoutableLocation('George H. Luck School', 'Edmonton')).toBe(true)
    expect(isRoutableLocation('Confederation Arena', 'Edmonton')).toBe(true)
    expect(isRoutableLocation('Microsoft Teams Meeting', 'Edmonton')).toBe(false)
    expect(isRoutableLocation('https://zoom.us/j/123', 'Edmonton')).toBe(false)
    expect(isRoutableLocation('Edmonton', 'Edmonton')).toBe(false)
    expect(isRoutableLocation('Edmonton, AB', 'Edmonton')).toBe(false)
    expect(isRoutableLocation('Edmonton AB Canada', 'Edmonton')).toBe(false)
    expect(isRoutableLocation('', 'Edmonton')).toBe(false)
    expect(isRoutableLocation(null)).toBe(false)
  })
})

describe('leave-by arithmetic', () => {
  it('start − drive − buffer; Google "1234s" → minutes rounded up', () => {
    expect(leaveAtMs(10 * HOUR, 18, 5)).toBe(10 * HOUR - 23 * MIN)
    expect(durationToMinutes('1081s')).toBe(19)
    expect(durationToMinutes('60s')).toBe(1)
    expect(durationToMinutes('5s')).toBe(1)
    expect(durationToMinutes(undefined)).toBeNull()
  })
  it('asks Google about the time we would leave, never the past', () => {
    const now = 100 * HOUR
    expect(departureFor(now, now + 5 * HOUR, 5, undefined)).toBe(now + 5 * HOUR - 35 * MIN)
    expect(departureFor(now, now + 5 * HOUR, 5, { location: 'x', minutes: 20, fetchedAt: now })).toBe(now + 5 * HOUR - 25 * MIN)
    expect(departureFor(now, now + 10 * MIN, 5, undefined)).toBe(now + MIN)
  })
})

describe('when to look a trip up again (about 5 lookups a trip)', () => {
  const now = 1000 * HOUR
  const loc = 'Tipton Arena'
  const fresh = (minutes: number | null, ageMin: number) => ({ location: loc, minutes, fetchedAt: now - ageMin * MIN })
  it('once when it comes within a day; never for past or far-off events', () => {
    expect(refreshDue(now, now + 20 * HOUR, 5, undefined, loc)).toBe(true)
    expect(refreshDue(now, now + 30 * HOUR, 5, undefined, loc)).toBe(false)
    expect(refreshDue(now, now - MIN, 5, undefined, loc)).toBe(false)
  })
  it('a changed location is looked up again straight away', () => {
    expect(refreshDue(now, now + 20 * HOUR, 5, fresh(20, 1), loc)).toBe(false)
    expect(refreshDue(now, now + 20 * HOUR, 5, fresh(20, 1), 'Kinsmen Arena')).toBe(true)
  })
  it('every 6 h while far off, hourly from 3 h before leaving, every 20 min in the last 90', () => {
    // leave in ~5 h
    expect(refreshDue(now, now + 5 * HOUR + 25 * MIN, 5, fresh(20, 5 * 60), loc)).toBe(false)
    expect(refreshDue(now, now + 5 * HOUR + 25 * MIN, 5, fresh(20, 6 * 60 + 1), loc)).toBe(true)
    // leave in ~2 h
    expect(refreshDue(now, now + 2 * HOUR + 25 * MIN, 5, fresh(20, 59), loc)).toBe(false)
    expect(refreshDue(now, now + 2 * HOUR + 25 * MIN, 5, fresh(20, 61), loc)).toBe(true)
    // leave in ~1 h
    expect(refreshDue(now, now + HOUR + 25 * MIN, 5, fresh(20, 19), loc)).toBe(false)
    expect(refreshDue(now, now + HOUR + 25 * MIN, 5, fresh(20, 21), loc)).toBe(true)
    // time to go already: no more lookups
    expect(refreshDue(now, now + 20 * MIN, 5, fresh(20, 60), loc)).toBe(false)
  })
  it('a place Google cannot route to is retried a day later', () => {
    expect(refreshDue(now, now + 10 * HOUR, 5, fresh(null, 60), loc)).toBe(false)
    expect(refreshDue(now, now + 10 * HOUR, 5, { location: loc, minutes: null, fetchedAt: now - 25 * HOUR }, loc)).toBe(true)
  })
})

describe('travel service', () => {
  let handle: DbHandle
  let now = Date.parse('2026-11-06T15:00:00Z')
  beforeEach(() => {
    handle = openDatabase(':memory:')
    now = Date.parse('2026-11-06T15:00:00Z')
  })
  afterEach(() => handle.sqlite.close())

  function setup(lookup: RouteLookup) {
    const settings = createSettingsService(handle.db)
    const events = createEventService(handle.db, () => 'America/Edmonton')
    const cal = createCalendarService(handle.db).create({ name: 'Family', color: '#46A758' })
    const add = (title: string, location: string | null, startIso: string) =>
      events.create({
        calendarId: cal.id,
        title,
        location,
        start: startIso,
        end: new Date(Date.parse(startIso) + HOUR).toISOString(),
        tz: 'America/Edmonton',
        allDay: false,
        personIds: []
      })
    settings.set({ travel: { enabled: true, homeAddress: '123 Home St, Edmonton', bufferMinutes: 5 } })
    const onChange = vi.fn()
    const travel = createTravelService({ settings, events, onChange, lookup, now: () => now })
    return { settings, add, travel, onChange }
  }

  it('looks up located events, skips online ones, and gives leave-by times', async () => {
    const lookup = vi.fn<RouteLookup>(async () => 18)
    const { add, travel, onChange } = setup(lookup)
    add('Hockey', 'Tipton Arena, 10828 80 Ave NW, Edmonton', '2026-11-06T23:00:00Z')
    add('Standup', 'Microsoft Teams Meeting', '2026-11-06T17:00:00Z')
    add('Nowhere', null, '2026-11-06T18:00:00Z')
    expect(travel.leaveTimes()).toEqual([]) // nothing without a key
    travel.setApiKey('AIza-test-key-0123456789abcdef')
    await travel.refresh()
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup.mock.calls[0][0]).toBe('AIza-test-key-0123456789abcdef')
    expect(lookup.mock.calls[0][1]).toBe('123 Home St, Edmonton')
    expect(onChange).toHaveBeenCalled()
    const [t] = travel.leaveTimes()
    expect(t.title).toBe('Hockey')
    expect(t.driveMinutes).toBe(18)
    expect(t.leaveAt).toBe('2026-11-06T22:37:00.000Z') // 23:00 − 18 − 5
    // a second refresh right away does nothing (cached)
    await travel.refresh()
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(travel.status()).toMatchObject({ keySet: true, callsToday: 1, callsThisMonth: 1, lastError: null })
  })

  it('stops at the daily cap', async () => {
    const lookup = vi.fn<RouteLookup>(async () => 10)
    const { add, travel, settings } = setup(lookup)
    travel.setApiKey('AIza-test-key-0123456789abcdef')
    settings.setRaw('travel.usage', JSON.stringify({ day: '2026-11-06', dayCount: DAILY_CALL_CAP, month: '2026-11', monthCount: DAILY_CALL_CAP }))
    add('Hockey', 'Tipton Arena', '2026-11-06T23:00:00Z')
    await travel.refresh()
    expect(lookup).not.toHaveBeenCalled()
    expect(travel.status().lastError).toMatch(/limit/)
  })

  it('a bad key is reported, not retried in a loop', async () => {
    const lookup = vi.fn<RouteLookup>(async () => {
      throw new Error('API key not valid')
    })
    const { add, travel } = setup(lookup)
    travel.setApiKey('AIza-test-key-0123456789abcdef')
    add('A', 'Tipton Arena', '2026-11-06T23:00:00Z')
    add('B', 'Kinsmen Arena', '2026-11-06T23:30:00Z')
    await travel.refresh()
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(travel.status().lastError).toBe('API key not valid')
    expect(travel.leaveTimes()).toEqual([])
  })

  it('the settings schema accepts the travel block', () => {
    expect(
      settingsPatchSchema.safeParse({ patch: { travel: { enabled: true, homeAddress: '1 Main St', bufferMinutes: 10 } } }).success
    ).toBe(true)
  })
})
