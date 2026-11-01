import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { dayRange, eachDay, monthGridRange, weekRange, weekViewRange } from '../../src/shared/dates'

const CHI = 'America/Chicago'

describe('weekRange', () => {
  it('starts on Sunday when weekStartsOn=0', () => {
    // 2026-06-10 is a Wednesday
    const r = weekRange('2026-06-10', CHI, 0)
    const start = DateTime.fromISO(r.start, { zone: 'utc' }).setZone(CHI)
    expect(start.toFormat('cccc yyyy-MM-dd')).toBe('Sunday 2026-06-07')
    expect(eachDay(r, CHI)).toHaveLength(7)
  })

  it('starts on Monday when weekStartsOn=1', () => {
    const r = weekRange('2026-06-10', CHI, 1)
    const start = DateTime.fromISO(r.start, { zone: 'utc' }).setZone(CHI)
    expect(start.toFormat('cccc yyyy-MM-dd')).toBe('Monday 2026-06-08')
  })

  it('is stable when the focused date is the week start itself', () => {
    const r = weekRange('2026-06-07', CHI, 0)
    const start = DateTime.fromISO(r.start, { zone: 'utc' }).setZone(CHI)
    expect(start.toISODate()).toBe('2026-06-07')
  })
})

describe('weekViewRange', () => {
  const firstDay = (r: { start: string }): string =>
    DateTime.fromISO(r.start, { zone: 'utc' }).setZone(CHI).toISODate()!

  it('rolling starts on the focused date itself', () => {
    // 2026-06-10 is a Wednesday
    const r = weekViewRange('2026-06-10', CHI, 'rolling', 0)
    expect(firstDay(r)).toBe('2026-06-10')
    expect(eachDay(r, CHI)).toHaveLength(7)
  })

  it('fixed matches the calendar week', () => {
    expect(weekViewRange('2026-06-10', CHI, 'fixed', 1)).toEqual(weekRange('2026-06-10', CHI, 1))
  })

  it('rolling pages butt up against each other when stepping a week at a time', () => {
    const r = weekViewRange('2026-06-10', CHI, 'rolling', 0)
    const next = weekViewRange('2026-06-17', CHI, 'rolling', 0)
    expect(next.start).toBe(r.end)
  })

  it('still shows 7 local days across a DST change', () => {
    // US DST ends 2026-11-01
    const days = eachDay(weekViewRange('2026-10-30', CHI, 'rolling', 0), CHI)
    expect(days.map((d) => d.toISODate())).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05'
    ])
  })
})

describe('dayRange', () => {
  it('covers exactly one local day', () => {
    const r = dayRange('2026-06-10', CHI)
    expect(eachDay(r, CHI)).toHaveLength(1)
  })
})

describe('monthGridRange', () => {
  it('always returns a 42-day grid starting on the week boundary', () => {
    const r = monthGridRange('2026-06-10', CHI, 0)
    const days = eachDay(r, CHI)
    expect(days).toHaveLength(42)
    expect(days[0].weekday).toBe(7) // Sunday
    expect(days[0].toISODate()! <= '2026-06-01').toBe(true)
  })
})
