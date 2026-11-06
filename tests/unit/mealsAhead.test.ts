import { describe, expect, it } from 'vitest'
import { mealsAhead } from '../../src/shared/mealsAhead'
import type { MealSlotDto } from '../../src/shared/types'

const day = '2026-11-06'
const meals: MealSlotDto[] = [
  { date: day, slot: 'snack', text: 'Apples' },
  { date: day, slot: 'dinner', text: 'Tacos' },
  { date: day, slot: 'breakfast', text: 'Pancakes' },
  { date: day, slot: 'lunch', text: 'Soup' }
]
const slots = (hour: number, m = meals) => mealsAhead(m, hour).map((x) => x.slot)

describe("screensaver meals: today's still to come", () => {
  it('breakfast goes at 9 am, lunch at 1 pm, dinner at 6 pm; the snack always stays, last', () => {
    expect(slots(8)).toEqual(['breakfast', 'lunch', 'dinner', 'snack'])
    expect(slots(9)).toEqual(['lunch', 'dinner', 'snack'])
    expect(slots(12)).toEqual(['lunch', 'dinner', 'snack'])
    expect(slots(13)).toEqual(['dinner', 'snack'])
    expect(slots(18)).toEqual(['snack'])
    expect(slots(23)).toEqual(['snack'])
  })

  it('leaves out meals with nothing planned', () => {
    expect(slots(7, [{ date: day, slot: 'lunch', text: 'Soup' }, { date: day, slot: 'dinner', text: '  ' }])).toEqual(['lunch'])
    expect(slots(19, [{ date: day, slot: 'dinner', text: 'Tacos' }])).toEqual([])
  })
})
