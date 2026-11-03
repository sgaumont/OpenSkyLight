import { describe, expect, it } from 'vitest'
import { sortDayChores } from '../../src/shared/choreOrder'

describe('sortDayChores', () => {
  it('lists Everyone chores first, then A-Z within each kind', () => {
    const chores = [
      { mode: 'anyone' as const, title: 'Read' },
      { mode: 'each' as const, title: 'Outside' },
      { mode: 'anyone' as const, title: 'Empty dishwasher' },
      { mode: 'each' as const, title: 'Creative' }
    ]
    expect(sortDayChores(chores).map((c) => c.title)).toEqual(['Creative', 'Outside', 'Empty dishwasher', 'Read'])
    expect(chores[0].title).toBe('Read') // the input is left as it was
  })
})
