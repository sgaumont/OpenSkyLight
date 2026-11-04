import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { zoneFor } from '../../src/shared/zones'
import { expandOccurrences } from '../../src/shared/recurrence/expand'
import { parseGoogleRecurrence } from '../../src/main/sync/googleMap'

describe('Alberta Time (no fall back from 2026-11-01)', () => {
  it('Edmonton is UTC−6 all year from November 2026, unchanged before', () => {
    const at = (iso: string) => DateTime.fromISO(iso, { zone: zoneFor('America/Edmonton') }).toFormat('ZZ')
    expect(at('2026-07-01T12:00')).toBe('-06:00')
    expect(at('2025-12-01T12:00')).toBe('-07:00')
    expect(at('2026-11-05T12:00')).toBe('-06:00')
    expect(at('2027-01-15T12:00')).toBe('-06:00')
  })

  it("a weekly series from September keeps its clock time, and Google's instance replaces it (no duplicate)", () => {
    // "Jarred at Terwilliger": Thursdays 9:30 from Sept 17; Google sent the Nov 5 instance at 15:30Z
    const master = {
      id: 'm', startAt: '2026-09-17T15:30:00Z', endAt: '2026-09-17T16:30:00Z', tz: 'America/Edmonton',
      allDay: false, rrule: 'FREQ=WEEKLY;WKST=MO', rdates: null, exdates: null
    }
    const ex = { id: 'x', recurringEventId: 'm', originalStartAt: '2026-11-05T15:30:00Z', startAt: '2026-11-05T15:30:00Z', endAt: '2026-11-05T16:30:00Z', status: 'confirmed' as const }
    const occ = expandOccurrences(master, [ex], '2026-11-05T06:00:00Z', '2026-11-06T06:00:00Z')
    expect(occ.map((o) => [o.eventId, o.start])).toEqual([['x', '2026-11-05T15:30:00Z']])
    const plain = expandOccurrences(master, [], '2026-11-12T06:00:00Z', '2026-11-13T06:00:00Z')
    expect(plain.map((o) => o.start)).toEqual(['2026-11-12T15:30:00Z'])
  })

  it('EXDATEs in Edmonton wall time use the new offset', () => {
    expect(parseGoogleRecurrence(['EXDATE;TZID=America/Edmonton:20261105T093000'], 'America/Edmonton').exdates).toEqual([
      '2026-11-05T15:30:00Z'
    ])
  })
})
