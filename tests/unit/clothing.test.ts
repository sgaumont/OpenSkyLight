import { describe, expect, it } from 'vitest'
import { fromCelsius, pickClothing, toCelsius } from '../../src/shared/clothing'
import { settingsPatchSchema } from '../../src/shared/ipc/schemas'
import { DEFAULT_SETTINGS } from '../../src/shared/types'

const s = { shortsMinC: 20, pantsMinC: 10 }

describe('what to wear (OPE-20)', () => {
  it('the highest minimum that today\'s high still meets', () => {
    expect(pickClothing(25, 'c', s)).toBe('shorts')
    expect(pickClothing(20, 'c', s)).toBe('shorts') // meets = at or above
    expect(pickClothing(19, 'c', s)).toBe('pants')
    expect(pickClothing(15, 'c', s)).toBe('pants')
    expect(pickClothing(10, 'c', s)).toBe('pants')
    expect(pickClothing(9, 'c', s)).toBe('jacket')
    expect(pickClothing(-25, 'c', s)).toBe('jacket')
  })
  it('works the same in °F (minimums stored in °C)', () => {
    expect(fromCelsius(20, 'f')).toBe(68)
    expect(fromCelsius(10, 'f')).toBe(50)
    expect(pickClothing(68, 'f', s)).toBe('shorts')
    expect(pickClothing(67, 'f', s)).toBe('pants')
    expect(pickClothing(50, 'f', s)).toBe('pants')
    expect(pickClothing(49, 'f', s)).toBe('jacket')
    // a minimum typed in °F comes back as the same °F
    expect(fromCelsius(toCelsius(70, 'f'), 'f')).toBe(70)
    expect(pickClothing(70, 'f', { shortsMinC: toCelsius(70, 'f'), pantsMinC: toCelsius(45, 'f') })).toBe('shorts')
    expect(pickClothing(69, 'f', { shortsMinC: toCelsius(70, 'f'), pantsMinC: toCelsius(45, 'f') })).toBe('pants')
  })
  it('off by default, 20° / 10° C', () => {
    expect(DEFAULT_SETTINGS.clothing).toEqual({ enabled: false, shortsMinC: 20, pantsMinC: 10 })
  })
  it('settings must keep shorts above pants', () => {
    expect(settingsPatchSchema.safeParse({ patch: { clothing: { enabled: true, shortsMinC: 22, pantsMinC: 12 } } }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ patch: { clothing: { enabled: true, shortsMinC: 10, pantsMinC: 12 } } }).success).toBe(false)
  })
})
