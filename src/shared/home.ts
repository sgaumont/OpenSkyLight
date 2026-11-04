import type { HomeTile, HomeTileConfig, HomeTileType } from './types'
import { clampTextSize } from './textSize'

/**
 * Pure grid math for the customizable home screen. Shared by the renderer
 * (drag/resize validation) and the tests; no DOM, no Electron.
 */

/**
 * Each original 12×6 grid cell is split into HOME_GRID_SCALE steps per side, so
 * tiles snap 3× more finely. Sizes below are written in original cells × scale;
 * with the fixed 12px gap, 3 fine cells span exactly one original cell.
 */
export const HOME_GRID_SCALE = 3
/** original cells → fine grid units */
export const cells = (n: number): number => n * HOME_GRID_SCALE

export const HOME_COLS = cells(12)
export const HOME_ROWS = cells(6)

/** Layouts saved on the original 12×6 grid, converted to the fine grid (one-time). */
export function scaleLayout(raw: unknown, factor: number = HOME_GRID_SCALE): unknown {
  if (!Array.isArray(raw)) return raw
  return raw.map((t) => {
    if (typeof t !== 'object' || t === null) return t
    const tile = t as Record<string, unknown>
    const scaled = { ...tile }
    for (const k of ['x', 'y', 'w', 'h']) {
      if (typeof tile[k] === 'number') scaled[k] = (tile[k] as number) * factor
    }
    return scaled
  })
}

export interface TileSpec {
  minW: number
  minH: number
  defaultW: number
  defaultH: number
  allowMultiple: boolean
  /** The only string config keys this tile type may carry — the single source of
   * truth that sanitizeLayout enforces (per-type, so a list tile can never
   * smuggle a cameraId, and forgetting a key here fails visibly in tests).
   * `textSize` is the one universal key, handled separately. */
  configKeys: (keyof HomeTileConfig)[]
}

/** min/default sizes in original cells, scaled to the fine grid */
function spec(minW: number, minH: number, defaultW: number, defaultH: number, rest: Pick<TileSpec, 'allowMultiple' | 'configKeys'>): TileSpec {
  return { minW: cells(minW), minH: cells(minH), defaultW: cells(defaultW), defaultH: cells(defaultH), ...rest }
}

export const TILE_SPECS: Record<HomeTileType, TileSpec> = {
  // text tiles scroll (TileScroll), so their minimum heights are low; Today keeps
  // 2 rows for its meal strip. Weather has a 1-row layout and scales to its box.
  // Clock/photo/camera/timer don't scroll.
  todayEvents: spec(3, 2, 4, 6, { allowMultiple: false, configKeys: [] }),
  weekAgenda: spec(4, 1, 5, 4, { allowMultiple: false, configKeys: [] }),
  weather: spec(2, 1, 3, 2, { allowMultiple: false, configKeys: [] }),
  choresProgress: spec(3, 1, 3, 2, { allowMultiple: false, configKeys: [] }),
  starBalances: spec(2, 1, 2, 2, { allowMultiple: false, configKeys: [] }),
  list: spec(2, 1, 3, 4, { allowMultiple: true, configKeys: ['listId'] }),
  meals: spec(2, 1, 3, 2, { allowMultiple: false, configKeys: [] }),
  clock: spec(2, 2, 2, 2, { allowMultiple: false, configKeys: [] }),
  photo: spec(2, 2, 3, 4, { allowMultiple: true, configKeys: [] }),
  news: spec(3, 1, 4, 3, { allowMultiple: true, configKeys: ['feedId'] }),
  camera: spec(3, 2, 4, 3, { allowMultiple: true, configKeys: ['cameraId'] }),
  birdnet: spec(3, 1, 4, 4, { allowMultiple: true, configKeys: ['birdnetUrl'] }),
  timer: spec(3, 2, 4, 3, { allowMultiple: false, configKeys: [] }),
  countdowns: spec(2, 1, 3, 2, { allowMultiple: false, configKeys: [] })
}

/** Tiles the full grid with no gaps (written in original cells). Clock/weather tiles
 * are NOT placed by default — the header already shows both — but stay in the Add Tile sheet. */
export const DEFAULT_HOME_LAYOUT: HomeTile[] = scaleLayout([
  { id: 'default-todayEvents', type: 'todayEvents', x: 0, y: 0, w: 4, h: 6 },
  { id: 'default-weekAgenda', type: 'weekAgenda', x: 4, y: 0, w: 5, h: 6 },
  { id: 'default-meals', type: 'meals', x: 9, y: 0, w: 3, h: 2 },
  { id: 'default-choresProgress', type: 'choresProgress', x: 9, y: 2, w: 3, h: 2 },
  { id: 'default-starBalances', type: 'starBalances', x: 9, y: 4, w: 3, h: 2 }
]) as HomeTile[]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function inBounds(r: Rect): boolean {
  return r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= HOME_COLS && r.y + r.h <= HOME_ROWS
}

/** Can `rect` be placed without leaving the grid or hitting another tile? */
export function canPlace(layout: HomeTile[], rect: Rect, excludeId?: string): boolean {
  if (!inBounds(rect)) return false
  return layout.every((t) => t.id === excludeId || !rectsOverlap(t, rect))
}

/** First free w×h spot scanning row-major, or null when the grid is full. */
export function findFreeSpot(layout: HomeTile[], w: number, h: number): { x: number; y: number } | null {
  for (let y = 0; y + h <= HOME_ROWS; y++) {
    for (let x = 0; x + w <= HOME_COLS; x++) {
      if (canPlace(layout, { x, y, w, h })) return { x, y }
    }
  }
  return null
}

const TILE_TYPES = new Set<string>(Object.keys(TILE_SPECS))

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * Make any stored value safe to render: drop garbage, clamp coords, enforce
 * per-type minimum sizes, dedupe ids, and resolve overlaps deterministically.
 * Returns DEFAULT_HOME_LAYOUT when the value isn't an array at all.
 */
export function sanitizeLayout(raw: unknown): HomeTile[] {
  if (!Array.isArray(raw)) return DEFAULT_HOME_LAYOUT
  const out: HomeTile[] = []
  const seenIds = new Set<string>()

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const t = entry as Partial<HomeTile>
    if (typeof t.type !== 'string' || !TILE_TYPES.has(t.type)) continue
    // id constraints mirror homeTileSchema — anything sanitize keeps must
    // also be SAVEABLE, or the user gets stuck unable to persist any edit
    if (typeof t.id !== 'string' || t.id.length === 0 || t.id.length > 80 || seenIds.has(t.id)) continue
    const spec = TILE_SPECS[t.type as HomeTileType]

    let w = clamp(Math.round(Number(t.w) || spec.defaultW), spec.minW, HOME_COLS)
    let h = clamp(Math.round(Number(t.h) || spec.defaultH), spec.minH, HOME_ROWS)
    let x = clamp(Math.round(Number(t.x) || 0), 0, HOME_COLS - 1)
    let y = clamp(Math.round(Number(t.y) || 0), 0, HOME_ROWS - 1)
    // shift left/up before shrinking
    x = Math.min(x, HOME_COLS - w)
    y = Math.min(y, HOME_ROWS - h)

    let rect: Rect = { x, y, w, h }
    if (!canPlace(out, rect)) {
      const spot = findFreeSpot(out, w, h) ?? findFreeSpot(out, spec.minW, spec.minH)
      if (!spot) continue // grid full — drop the tile
      const fitsDefault = canPlace(out, { ...spot, w, h })
      rect = fitsDefault ? { ...spot, w, h } : { ...spot, w: spec.minW, h: spec.minH }
    }

    seenIds.add(t.id)
    // copy only this type's declared config keys, with schema-compatible values
    let config: HomeTileConfig | undefined
    if (spec.configKeys.length > 0 && t.config && typeof t.config === 'object') {
      const rawConfig = t.config as Record<string, unknown>
      for (const key of spec.configKeys) {
        const value = rawConfig[key]
        // 200 (not 80) so a birdnet URL fits; MUST match homeTileSchema's max
        if (typeof value === 'string' && value.length >= 1 && value.length <= 200) {
          config = { ...config, [key]: value }
        }
      }
    }
    // every tile type may carry a text size; keep only valid non-default ones
    const textSize = (t.config as { textSize?: unknown } | undefined)?.textSize
    if (typeof textSize === 'number' && textSize !== 100 && clampTextSize(textSize) === textSize) {
      config = { ...config, textSize }
    }
    out.push({
      id: t.id,
      type: t.type as HomeTileType,
      ...rect,
      ...(config ? { config } : {})
    })
  }
  return out
}
