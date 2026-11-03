import { describe, expect, it } from 'vitest'
import { choreHistoryCutoff, choreHistoryDates } from '../../src/shared/choreHistory'

describe('chore history window', () => {
  it('is today and the two days before it, newest first', () => {
    expect(choreHistoryDates('2026-11-02', 'America/Chicago')).toEqual(['2026-11-02', '2026-11-01', '2026-10-31'])
  })

  it('purges everything before the oldest day shown', () => {
    expect(choreHistoryCutoff('2026-03-01', 'America/Chicago')).toBe('2026-02-27')
  })
})
