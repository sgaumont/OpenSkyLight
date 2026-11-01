import { describe, expect, it } from 'vitest'
import { hasEnded, withoutEnded } from '../../src/shared/occurrences'

const now = Date.parse('2026-11-01T15:00:00Z')
const timed = (start: string, end: string) => ({ allDay: false, start, end })

describe('hasEnded', () => {
  it('treats a timed event as ended once its end time has passed', () => {
    expect(hasEnded(timed('2026-11-01T13:00:00Z', '2026-11-01T14:00:00Z'), now)).toBe(true)
    expect(hasEnded(timed('2026-11-01T14:00:00Z', '2026-11-01T15:00:00Z'), now)).toBe(true)
  })

  it('keeps in-progress and upcoming events', () => {
    expect(hasEnded(timed('2026-11-01T14:30:00Z', '2026-11-01T15:30:00Z'), now)).toBe(false)
    expect(hasEnded(timed('2026-11-01T16:00:00Z', '2026-11-01T17:00:00Z'), now)).toBe(false)
  })

  it('keeps a multi-day timed event that is still running', () => {
    expect(hasEnded(timed('2026-10-31T20:00:00Z', '2026-11-02T09:00:00Z'), now)).toBe(false)
  })

  it('never hides all-day events', () => {
    expect(hasEnded({ allDay: true, end: '2026-11-01T00:00:00Z' }, now)).toBe(false)
  })
})

describe('withoutEnded', () => {
  it('filters finished events and preserves order', () => {
    const occs = [
      { allDay: true, end: '2026-11-02T00:00:00Z', id: 'allday' },
      { allDay: false, end: '2026-11-01T09:00:00Z', id: 'morning' },
      { allDay: false, end: '2026-11-01T15:30:00Z', id: 'now' },
      { allDay: false, end: '2026-11-01T19:00:00Z', id: 'evening' }
    ]
    expect(withoutEnded(occs, now).map((o) => o.id)).toEqual(['allday', 'now', 'evening'])
  })
})
