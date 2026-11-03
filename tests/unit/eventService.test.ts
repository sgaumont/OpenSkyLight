import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { createEventService, type EventService } from '../../src/main/services/eventService'
import { createCalendarService } from '../../src/main/services/calendarService'

const CHI = 'America/Chicago'
const WINDOW = { start: '2026-06-01T00:00:00Z', end: '2026-07-01T00:00:00Z' }

describe('eventService', () => {
  let handle: DbHandle
  let service: EventService
  let calendarId: string

  beforeEach(() => {
    handle = openDatabase(':memory:')
    service = createEventService(handle.db)
    calendarId = createCalendarService(handle.db).list()[0].id
  })

  function createDaily9am() {
    return service.create({
      calendarId,
      title: 'Breakfast',
      start: '2026-06-01T14:00:00Z', // 9 AM Chicago
      end: '2026-06-01T14:30:00Z',
      tz: CHI,
      allDay: false,
      personIds: [],
      recurrence: { freq: 'daily' }
    })
  }

  it('creates and lists a one-off event', () => {
    service.create({
      calendarId,
      title: 'Dentist',
      start: '2026-06-10T19:00:00Z',
      end: '2026-06-10T20:00:00Z',
      tz: CHI,
      allDay: false,
      personIds: [],
      recurrence: null
    })
    const occs = service.getOccurrences(WINDOW)
    expect(occs).toHaveLength(1)
    expect(occs[0].title).toBe('Dentist')
    expect(occs[0].isRecurring).toBe(false)
  })

  it('rejects events that end before they start', () => {
    expect(() =>
      service.create({
        calendarId,
        title: 'Backwards',
        start: '2026-06-10T20:00:00Z',
        end: '2026-06-10T19:00:00Z',
        tz: CHI,
        allDay: false,
        personIds: [],
        recurrence: null
      })
    ).toThrow(/after start/i)
  })

  it('expands a recurring event', () => {
    createDaily9am()
    const occs = service.getOccurrences({ start: '2026-06-01T00:00:00Z', end: '2026-06-05T00:00:00Z' })
    expect(occs).toHaveLength(4)
    expect(occs.every((o) => o.isRecurring)).toBe(true)
  })

  it("update scope 'this' creates an exception without touching other occurrences", () => {
    const event = createDaily9am()
    service.update({
      id: event.id,
      scope: 'this',
      occurrenceStart: '2026-06-03T14:00:00Z',
      changes: { title: 'Pancake day', start: '2026-06-03T16:00:00Z', end: '2026-06-03T16:30:00Z' }
    })
    const occs = service.getOccurrences({ start: '2026-06-01T00:00:00Z', end: '2026-06-05T00:00:00Z' })
    expect(occs).toHaveLength(4)
    const changed = occs.find((o) => o.title === 'Pancake day')!
    expect(changed.start).toBe('2026-06-03T16:00:00Z')
    expect(changed.eventId).not.toBe(event.id)
    expect(changed.masterId).toBe(event.id)
    expect(occs.filter((o) => o.title === 'Breakfast')).toHaveLength(3)
  })

  it("update scope 'following' splits the series", () => {
    const event = createDaily9am()
    service.update({
      id: event.id,
      scope: 'following',
      occurrenceStart: '2026-06-04T14:00:00Z',
      changes: { title: 'Brunch' }
    })
    const occs = service.getOccurrences({ start: '2026-06-01T00:00:00Z', end: '2026-06-07T00:00:00Z' })
    const breakfasts = occs.filter((o) => o.title === 'Breakfast')
    const brunches = occs.filter((o) => o.title === 'Brunch')
    expect(breakfasts).toHaveLength(3) // Jun 1-3
    expect(brunches).toHaveLength(3) // Jun 4-6
    expect(brunches[0].start).toBe('2026-06-04T14:00:00Z')
    expect(new Set(brunches.map((b) => b.masterId)).size).toBe(1)
    expect(brunches[0].masterId).not.toBe(event.id)
  })

  it("update scope 'all' shifts the whole series by the edited delta", () => {
    const event = createDaily9am()
    // user edited the Jun 3 occurrence, moving 9:00 -> 10:00
    service.update({
      id: event.id,
      scope: 'all',
      occurrenceStart: '2026-06-03T14:00:00Z',
      changes: { start: '2026-06-03T15:00:00Z', end: '2026-06-03T15:30:00Z' }
    })
    const occs = service.getOccurrences({ start: '2026-06-01T00:00:00Z', end: '2026-06-03T00:00:00Z' })
    expect(occs[0].start).toBe('2026-06-01T15:00:00Z') // first occurrence moved too
  })

  it("delete scope 'this' removes one occurrence", () => {
    const event = createDaily9am()
    service.remove({ id: event.id, scope: 'this', occurrenceStart: '2026-06-02T14:00:00Z' })
    const occs = service.getOccurrences({ start: '2026-06-01T00:00:00Z', end: '2026-06-04T00:00:00Z' })
    expect(occs.map((o) => o.start)).toEqual(['2026-06-01T14:00:00Z', '2026-06-03T14:00:00Z'])
  })

  it("delete scope 'following' caps the series", () => {
    const event = createDaily9am()
    service.remove({ id: event.id, scope: 'following', occurrenceStart: '2026-06-04T14:00:00Z' })
    const occs = service.getOccurrences(WINDOW)
    expect(occs).toHaveLength(3) // Jun 1-3
  })

  it("delete scope 'all' removes everything including exceptions", () => {
    const event = createDaily9am()
    service.update({
      id: event.id,
      scope: 'this',
      occurrenceStart: '2026-06-03T14:00:00Z',
      changes: { title: 'Pancake day' }
    })
    service.remove({ id: event.id, scope: 'all' })
    expect(service.getOccurrences(WINDOW)).toHaveLength(0)
  })

  it('assigns and returns people', () => {
    const peopleIds = ['p1']
    handle.sqlite
      .prepare("INSERT INTO people (id, name, color, role, sort_order, created_at) VALUES ('p1','Kid','#46A758','child',0,'2026-01-01T00:00:00Z')")
      .run()
    service.create({
      calendarId,
      title: 'Soccer',
      start: '2026-06-10T21:00:00Z',
      end: '2026-06-10T22:00:00Z',
      tz: CHI,
      allDay: false,
      personIds: peopleIds,
      recurrence: null
    })
    const occs = service.getOccurrences(WINDOW)
    expect(occs[0].personIds).toEqual(['p1'])
  })

  describe('all-day events saved in another time zone', () => {
    // midnight Nov 5 → Nov 6 in Los Angeles is 2 am → 2 am in Chicago: it would cover two days
    const NOV = { start: '2026-11-01T00:00:00Z', end: '2026-11-30T00:00:00Z' }
    const createAnniversary = (recurrence: { freq: 'yearly' } | null) =>
      createEventService(handle.db, () => 'America/Los_Angeles').create({
        calendarId,
        title: 'Anniversary',
        start: '2026-11-05T08:00:00Z',
        end: '2026-11-06T08:00:00Z',
        tz: 'America/Los_Angeles',
        allDay: true,
        personIds: [],
        recurrence
      })

    it('still covers just its one day in the device zone', () => {
      createAnniversary(null)
      const occs = createEventService(handle.db, () => CHI).getOccurrences(NOV)
      expect(occs).toHaveLength(1)
      expect(occs[0].start).toBe('2026-11-05T06:00:00Z')
      expect(occs[0].end).toBe('2026-11-06T06:00:00Z')
    })

    it('every yearly occurrence stays on its day', () => {
      createAnniversary({ freq: 'yearly' })
      const occs = createEventService(handle.db, () => CHI).getOccurrences({
        start: '2027-11-01T00:00:00Z',
        end: '2027-11-30T00:00:00Z'
      })
      expect(occs.map((o) => [o.start, o.end])).toEqual([['2027-11-05T05:00:00Z', '2027-11-06T05:00:00Z']])
    })
  })
})
