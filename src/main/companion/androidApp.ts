import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The Android app (Family Skyview) this tablet hands out: `npm run dist` builds the APK and
 * electron-builder packs it into resources/family-skyview/ (scripts/build-android.mjs --bundle).
 * Phones download it from GET /app/family-skyview.apk and update from it when the tablet is newer.
 */
export interface AndroidAppInfo {
  path: string
  version: string
  sizeBytes: number
}

/** What build-android.mjs writes next to the APK. */
interface Manifest {
  version: string
  file: string
}

/** The bundled APK, or null when this build doesn't have one (dev runs without `--bundle`, older builds). */
export function findAndroidApp(dirs: string[]): AndroidAppInfo | null {
  for (const dir of dirs) {
    try {
      const manifestPath = join(dir, 'family-skyview.json')
      if (!existsSync(manifestPath)) continue
      const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
      const path = join(dir, m.file)
      if (!/^\d+\.\d+\.\d+$/.test(m.version) || !existsSync(path)) continue
      return { path, version: m.version, sizeBytes: statSync(path).size }
    } catch {
      // unreadable: try the next place
    }
  }
  return null
}
