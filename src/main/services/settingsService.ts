import { eq } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { settings } from '../db/schema'
import { DEFAULT_SETTINGS, type AppSettings, type HomeTile } from '@shared/types'
import { HOME_GRID_SCALE, scaleLayout } from '@shared/home'

export function createSettingsService(db: AppDb) {
  function getAll(): AppSettings {
    const rows = db.select().from(settings).all()
    const stored: Record<string, unknown> = {}
    const known = new Set(Object.keys(DEFAULT_SETTINGS))
    for (const row of rows) {
      // internal keys (e.g. encrypted Google credentials) never cross to the renderer
      if (!known.has(row.key)) continue
      try {
        stored[row.key] = JSON.parse(row.value)
      } catch {
        // ignore corrupt values; defaults win
      }
    }
    return { ...DEFAULT_SETTINGS, ...stored } as AppSettings
  }

  /** Raw access for internal (non-renderer) keys like encrypted credentials. */
  function getRaw(key: string): string | null {
    const [row] = db.select().from(settings).where(eq(settings.key, key)).all()
    return row?.value ?? null
  }

  function setRaw(key: string, value: string): void {
    const existing = db.select().from(settings).where(eq(settings.key, key)).all()
    if (existing.length > 0) db.update(settings).set({ value }).where(eq(settings.key, key)).run()
    else db.insert(settings).values({ key, value }).run()
  }

  function deleteRaw(key: string): void {
    db.delete(settings).where(eq(settings.key, key)).run()
  }

  function set(patch: Partial<AppSettings>): AppSettings {
    db.transaction((tx) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue
        const json = JSON.stringify(value)
        const existing = tx.select().from(settings).where(eq(settings.key, key)).all()
        if (existing.length > 0) {
          tx.update(settings).set({ value: json }).where(eq(settings.key, key)).run()
        } else {
          tx.insert(settings).values({ key, value: json }).run()
        }
      }
    })
    return getAll()
  }

  return { getAll, set, getRaw, setRaw, deleteRaw }
}

export type SettingsService = ReturnType<typeof createSettingsService>

/** internal marker: the Home layout is stored in fine-grid units at this scale */
const KEY_HOME_GRID_SCALE = 'homeGridScale'

/**
 * One-time: a Home layout saved on the original 12×6 grid is scaled up to the
 * fine grid, so it looks identical. Runs at boot, before the renderer loads.
 */
export function migrateHomeGrid(settings: SettingsService): void {
  if (settings.getRaw(KEY_HOME_GRID_SCALE) === String(HOME_GRID_SCALE)) return
  const stored = settings.getRaw('homeLayout')
  if (stored !== null) {
    try {
      const layout = JSON.parse(stored)
      if (Array.isArray(layout)) settings.set({ homeLayout: scaleLayout(layout) as HomeTile[] })
    } catch {
      // corrupt value: leave it; sanitizeLayout falls back to the default layout
    }
  }
  settings.setRaw(KEY_HOME_GRID_SCALE, String(HOME_GRID_SCALE))
}
