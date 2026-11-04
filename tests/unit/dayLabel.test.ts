import { describe, expect, it } from 'vitest'
import { dayLabel } from '../../src/shared/dayLabel'

describe('dayLabel', () => {
  it('today is unlabelled, then yesterday, then the date', () => {
    expect(dayLabel('2026-11-04', '2026-11-04')).toBe('')
    expect(dayLabel('2026-11-03', '2026-11-04')).toBe('yesterday')
    expect(dayLabel('2026-11-02', '2026-11-04')).toBe('Mon Nov 2')
    expect(dayLabel('2026-10-31', '2026-11-01')).toBe('yesterday') // across a month
  })
})
