import type { CalendarViewKind, TextSizeSettings } from './types'

/**
 * Text sizes are whole percentages. The overall size zooms the whole window;
 * tab and tile sizes are applied as CSS `zoom` relative to their parent, so
 * the effective size is always the product of the levels above it.
 */
export const TEXT_SIZE_MIN = 70
export const TEXT_SIZE_MAX = 200
export const TEXT_SIZE_STEP = 10

export function clampTextSize(pct: number): number {
  const stepped = Math.round(pct / TEXT_SIZE_STEP) * TEXT_SIZE_STEP
  return Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, stepped))
}

export function stepTextSize(pct: number, direction: 1 | -1): number {
  return clampTextSize(pct + direction * TEXT_SIZE_STEP)
}

/** The size a tab is shown at, in percent. */
export function tabTextSize(sizes: TextSizeSettings, view: CalendarViewKind): number {
  return sizes.tabs[view] ?? sizes.global
}

/** CSS zoom for a tab's content: relative, since the window zoom already applies `global`. */
export function tabZoom(sizes: TextSizeSettings, view: CalendarViewKind): number {
  return tabTextSize(sizes, view) / sizes.global
}

/** CSS zoom for a Home tile's content: the Home tab's zoom times the tile's own percent. */
export function tileZoom(sizes: TextSizeSettings, tilePct: number | undefined): number {
  return (tabZoom(sizes, 'home') * (tilePct ?? 100)) / 100
}

/** Sets (or clears, when it would just follow `global`) one tab's override. */
export function withTabTextSize(sizes: TextSizeSettings, view: CalendarViewKind, pct: number): TextSizeSettings {
  const tabs = { ...sizes.tabs }
  if (pct === sizes.global) delete tabs[view]
  else tabs[view] = clampTextSize(pct)
  return { ...sizes, tabs }
}
