import { describe, expect, it } from 'vitest'
import { anchorOnSave, defaultAssignees, scheduleOf, toRecurrence } from '../../src/shared/choreSchedule'
import type { PersonDto } from '../../src/shared/types'

describe('choreSchedule', () => {
  it('round-trips the three "Repeats" choices', () => {
    expect(scheduleOf(toRecurrence('daily', []))).toBe('daily')
    expect(toRecurrence('weekly', [5, 6])).toEqual({ freq: 'weekly', byWeekdays: [5, 6] })
    expect(scheduleOf(toRecurrence('weekly', [2]))).toBe('weekly')
    expect(toRecurrence('once', [1])).toBeNull()
    expect(scheduleOf(null)).toBe('once')
  })

  it('weekly with no days picked falls back to Monday', () => {
    expect(toRecurrence('weekly', [])).toEqual({ freq: 'weekly', byWeekdays: [0] })
  })

  it('a repeating chore switched to one time is due today; otherwise the anchor is left alone', () => {
    expect(anchorOnSave({ freq: 'daily' }, 'once', '2026-11-03')).toBe('2026-11-03')
    expect(anchorOnSave(null, 'once', '2026-11-03')).toBeUndefined()
    expect(anchorOnSave({ freq: 'daily' }, 'weekly', '2026-11-03')).toBeUndefined()
  })

  it('new "everyone" chores start with the kids, or everybody when there are none', () => {
    const p = (id: string, role: PersonDto['role']) => ({ id, role }) as PersonDto
    expect(defaultAssignees([p('mum', 'parent'), p('a', 'child'), p('b', 'child')])).toEqual(['a', 'b'])
    expect(defaultAssignees([p('mum', 'parent'), p('dad', 'parent')])).toEqual(['mum', 'dad'])
  })
})
