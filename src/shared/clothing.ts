/** "What to wear today" from today's forecast high: shorts, or pants below the shorts minimum. */

export type Clothing = 'shorts' | 'pants'

export const CLOTHING_EMOJI: Record<Clothing, string> = { shorts: '🩳', pants: '👖' }
export const CLOTHING_LABEL: Record<Clothing, string> = { shorts: 'Shorts', pants: 'Pants' }

/** The minimum daily high for shorts, stored in °C (pants are everything below it). */
export interface ClothingSettings {
  enabled: boolean
  shortsMinC: number
}

export const toCelsius = (t: number, unit: 'c' | 'f'): number => (unit === 'f' ? ((t - 32) * 5) / 9 : t)
/** A stored °C minimum as shown in the kiosk's unit, rounded to a whole degree. */
export const fromCelsius = (c: number, unit: 'c' | 'f'): number => Math.round(unit === 'f' ? (c * 9) / 5 + 32 : c)

/** Shorts when today's high meets the minimum (at or above), otherwise pants. */
export function pickClothing(high: number, unit: 'c' | 'f', s: Pick<ClothingSettings, 'shortsMinC'>): Clothing {
  // compare in the forecast's own unit, so a whole-degree minimum lines up exactly with a whole-degree high
  const shorts = unit === 'f' ? fromCelsius(s.shortsMinC, 'f') : s.shortsMinC
  return high >= shorts ? 'shorts' : 'pants'
}
