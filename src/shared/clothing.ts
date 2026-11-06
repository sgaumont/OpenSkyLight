/** "What to wear today" from today's forecast high: shorts, pants or a jacket. */

export type Clothing = 'shorts' | 'pants' | 'jacket'

export const CLOTHING_EMOJI: Record<Clothing, string> = { shorts: '🩳', pants: '👖', jacket: '🧥' }
export const CLOTHING_LABEL: Record<Clothing, string> = { shorts: 'Shorts', pants: 'Pants', jacket: 'Jacket' }

/** Minimum daily highs, stored in °C (the jacket is everything below pants). */
export interface ClothingSettings {
  enabled: boolean
  shortsMinC: number
  pantsMinC: number
}

export const toCelsius = (t: number, unit: 'c' | 'f'): number => (unit === 'f' ? ((t - 32) * 5) / 9 : t)
/** A stored °C minimum as shown in the kiosk's unit, rounded to a whole degree. */
export const fromCelsius = (c: number, unit: 'c' | 'f'): number => Math.round(unit === 'f' ? (c * 9) / 5 + 32 : c)

/** The icon whose minimum is the highest one today's high still meets (at or above). */
export function pickClothing(high: number, unit: 'c' | 'f', s: Pick<ClothingSettings, 'shortsMinC' | 'pantsMinC'>): Clothing {
  // compare in the forecast's own unit, so a whole-degree minimum lines up exactly with a whole-degree high
  const shorts = unit === 'f' ? fromCelsius(s.shortsMinC, 'f') : s.shortsMinC
  const pants = unit === 'f' ? fromCelsius(s.pantsMinC, 'f') : s.pantsMinC
  if (high >= shorts) return 'shorts'
  if (high >= pants) return 'pants'
  return 'jacket'
}
