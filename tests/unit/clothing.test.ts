import { describe, expect, it } from 'vitest'
import { fromCelsius, pickClothing, toCelsius } from '../../src/shared/clothing'
import { settingsPatchSchema } from '../../src/shared/ipc/schemas'
import { DEFAULT_SETTINGS } from '../../src/shared/types'

const s = { shortsMinC: 20 }

describe('what to wear (OPE-20)', () => {
  it('shorts when today\'s high meets the minimum, pants below it (no jacket)', () => {
    expect(pickClothing(25, 'c', s)).toBe('shorts')
    expect(pickClothing(20, 'c', s)).toBe('shorts') // meets = at or above
    expect(pickClothing(19, 'c', s)).toBe('pants')
    expect(pickClothing(5, 'c', s)).toBe('pants')
    expect(pickClothing(-25, 'c', s)).toBe('pants')
  })
  it('works the same in °F (minimum stored in °C)', () => {
    expect(fromCelsius(20, 'f')).toBe(68)
    expect(pickClothing(68, 'f', s)).toBe('shorts')
    expect(pickClothing(67, 'f', s)).toBe('pants')
    expect(pickClothing(20, 'f', s)).toBe('pants')
    // a minimum typed in °F comes back as the same °F
    expect(fromCelsius(toCelsius(70, 'f'), 'f')).toBe(70)
    expect(pickClothing(70, 'f', { shortsMinC: toCelsius(70, 'f') })).toBe('shorts')
    expect(pickClothing(69, 'f', { shortsMinC: toCelsius(70, 'f') })).toBe('pants')
  })
  it('off by default, shorts from 20° C', () => {
    expect(DEFAULT_SETTINGS.clothing).toEqual({ enabled: false, shortsMinC: 20 })
  })
  it('settings take just the shorts minimum; an old pants minimum is dropped', () => {
    expect(settingsPatchSchema.safeParse({ patch: { clothing: { enabled: true, shortsMinC: 22 } } }).success).toBe(true)
    const old = settingsPatchSchema.safeParse({ patch: { clothing: { enabled: true, shortsMinC: 22, pantsMinC: 12 } } })
    expect(old.success && old.data.patch.clothing).toEqual({ enabled: true, shortsMinC: 22 })
  })
})
