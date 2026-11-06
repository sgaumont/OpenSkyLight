import { MEAL_SLOTS, type MealSlotDto, type MealSlotKind } from './types'

/** The hour (local, 24h) from which a meal is over for the day; snack never is. */
export const MEAL_OVER_AT: Partial<Record<MealSlotKind, number>> = { breakfast: 9, lunch: 13, dinner: 18 }

/**
 * Today's meals still to come, in meal order with the snack last: breakfast drops off at 9 am,
 * lunch at 1 pm, dinner at 6 pm. Slots with nothing planned are left out.
 */
export function mealsAhead(meals: MealSlotDto[], hour: number): MealSlotDto[] {
  return MEAL_SLOTS.flatMap((slot) => {
    const over = MEAL_OVER_AT[slot]
    if (over !== undefined && hour >= over) return []
    const m = meals.find((x) => x.slot === slot && x.text.trim() !== '')
    return m ? [m] : []
  })
}
