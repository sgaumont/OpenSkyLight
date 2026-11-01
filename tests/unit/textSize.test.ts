import { describe, expect, it } from 'vitest'
import {
  clampTextSize,
  stepTextSize,
  tabTextSize,
  tabZoom,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  tileZoom,
  weekMealsZoom,
  withTabTextSize
} from '../../src/shared/textSize'
import { sanitizeLayout } from '../../src/shared/home'
import { settingsPatchSchema } from '../../src/shared/ipc/schemas'
import type { TextSizeSettings } from '../../src/shared/types'

const sizes = (global: number, tabs: TextSizeSettings['tabs'] = {}): TextSizeSettings => ({ global, tabs })

describe('clampTextSize / stepTextSize', () => {
  it('snaps to 10% steps within bounds', () => {
    expect(clampTextSize(113)).toBe(110)
    expect(clampTextSize(10)).toBe(TEXT_SIZE_MIN)
    expect(clampTextSize(999)).toBe(TEXT_SIZE_MAX)
  })
  it('steps and stops at the ends', () => {
    expect(stepTextSize(100, 1)).toBe(110)
    expect(stepTextSize(100, -1)).toBe(90)
    expect(stepTextSize(TEXT_SIZE_MAX, 1)).toBe(TEXT_SIZE_MAX)
    expect(stepTextSize(TEXT_SIZE_MIN, -1)).toBe(TEXT_SIZE_MIN)
  })
})

describe('tab and tile zoom', () => {
  it('a tab without an override follows the overall size (zoom 1)', () => {
    expect(tabTextSize(sizes(120), 'week')).toBe(120)
    expect(tabZoom(sizes(120), 'week')).toBe(1)
  })
  it('a tab override is relative to the overall window zoom', () => {
    expect(tabZoom(sizes(100, { week: 150 }), 'week')).toBe(1.5)
    expect(tabZoom(sizes(150, { week: 150 }), 'week')).toBe(1)
    expect(tabZoom(sizes(200, { week: 100 }), 'week')).toBe(0.5)
  })
  it('tile size multiplies the Home tab size', () => {
    expect(tileZoom(sizes(100), undefined)).toBe(1)
    expect(tileZoom(sizes(100, { home: 120 }), undefined)).toBeCloseTo(1.2)
    expect(tileZoom(sizes(100, { home: 120 }), 150)).toBeCloseTo(1.8)
  })
  it('week meals size multiplies on top of the Week tab (default 100%)', () => {
    expect(weekMealsZoom(sizes(100))).toBe(1)
    expect(weekMealsZoom({ ...sizes(100), weekMeals: 150 })).toBe(1.5)
  })
  it('setting a tab to the overall size removes the override', () => {
    const s = withTabTextSize(sizes(100, { week: 130 }), 'week', 100)
    expect(s.tabs).toEqual({})
    expect(withTabTextSize(sizes(100), 'day', 140).tabs).toEqual({ day: 140 })
  })
})

describe('tile textSize in layouts', () => {
  const tile = (config: Record<string, unknown>) => ({ id: 't', type: 'todayEvents', x: 0, y: 0, w: 4, h: 6, config })

  it('keeps a valid tile text size on any tile type', () => {
    expect(sanitizeLayout([tile({ textSize: 130 })])[0].config).toEqual({ textSize: 130 })
  })
  it('drops invalid or default sizes', () => {
    for (const textSize of [100, 135, 20, 500, '130']) {
      expect(sanitizeLayout([tile({ textSize })])[0].config).toBeUndefined()
    }
  })
  it('keeps text size alongside type-specific config', () => {
    const list = { id: 'l', type: 'list', x: 0, y: 0, w: 3, h: 4, config: { listId: 'abc', textSize: 80 } }
    expect(sanitizeLayout([list])[0].config).toEqual({ listId: 'abc', textSize: 80 })
  })
})

describe('settings patch validation', () => {
  it('accepts text sizes and per-tab overrides', () => {
    expect(settingsPatchSchema.safeParse({ patch: { textSize: { global: 120, tabs: { week: 150 } } } }).success).toBe(true)
  })
  it('accepts a week meals size and rejects an out-of-range one', () => {
    const patch = (weekMeals: number) => ({ patch: { textSize: { global: 100, tabs: {}, weekMeals } } })
    expect(settingsPatchSchema.safeParse(patch(140)).success).toBe(true)
    expect(settingsPatchSchema.safeParse(patch(20)).success).toBe(false)
  })
  it('rejects out-of-range sizes and unknown tabs', () => {
    expect(settingsPatchSchema.safeParse({ patch: { textSize: { global: 500, tabs: {} } } }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ patch: { textSize: { global: 100, tabs: { nope: 120 } } } }).success).toBe(false)
  })
  it('round-trips a sanitized layout with tile sizes', () => {
    const layout = sanitizeLayout([{ id: 't', type: 'todayEvents', x: 0, y: 0, w: 4, h: 6, config: { textSize: 140 } }])
    expect(settingsPatchSchema.safeParse({ patch: { homeLayout: layout } }).success).toBe(true)
  })
})
