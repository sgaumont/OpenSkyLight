import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findAndroidApp } from '../../src/main/companion/androidApp'
import { createCompanionTokens } from '../../src/main/companion/companionTokens'
import { ANDROID_APP_PATH, createCompanionServer, type CompanionServer } from '../../src/main/companion/companionServer'
import type { SettingsService } from '../../src/main/services/settingsService'
import { isNewer } from '../../src/shared/appVersion'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'osl-android-app-'))
  dirs.push(d)
  return d
}

/** a bundle folder the way scripts/build-android.mjs --bundle writes it */
function bundle(version = '0.8.173', bytes = 'PK fake apk'): string {
  const d = tmp()
  writeFileSync(join(d, 'Family-Skyview.apk'), bytes)
  writeFileSync(join(d, 'family-skyview.json'), JSON.stringify({ version, file: 'Family-Skyview.apk' }))
  return d
}

let server: CompanionServer | null = null
afterEach(() => {
  server?.stop()
  server = null
  // best effort: on Windows a virus scan can hold a just-written .apk for a moment
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // left in the temp folder
    }
  }
})

describe('findAndroidApp', () => {
  it('finds the bundled APK and its version', () => {
    const d = bundle('0.8.173', '12345')
    expect(findAndroidApp([tmp(), d])).toEqual({ path: join(d, 'Family-Skyview.apk'), version: '0.8.173', sizeBytes: 5 })
  })

  it('is null without a bundle, with a broken manifest, or when the APK is missing', () => {
    expect(findAndroidApp([tmp()])).toBeNull()
    const broken = tmp()
    writeFileSync(join(broken, 'family-skyview.json'), '{nope')
    expect(findAndroidApp([broken])).toBeNull()
    const noApk = tmp()
    writeFileSync(join(noApk, 'family-skyview.json'), JSON.stringify({ version: '0.8.173', file: 'Family-Skyview.apk' }))
    expect(findAndroidApp([noApk])).toBeNull()
  })
})

describe('isNewer', () => {
  it('compares versions number by number', () => {
    expect(isNewer('0.8.180', '0.8.173')).toBe(true)
    expect(isNewer('0.8.173', '0.8.173')).toBe(false)
    expect(isNewer('0.8.99', '0.8.173')).toBe(false)
    expect(isNewer('0.9.0', '0.8.999')).toBe(true)
  })
})

describe('companion server: the Android app download', () => {
  async function boot(app: ReturnType<typeof findAndroidApp>): Promise<string> {
    const store = new Map<string, string>()
    const companion = { enabled: true, port: 0 }
    const settings = {
      getRaw: (k: string) => store.get(k) ?? null,
      setRaw: (k: string, v: string) => void store.set(k, v),
      deleteRaw: (k: string) => void store.delete(k),
      getAll: () => ({ companion }) as never,
      set: () => ({}) as never
    } as SettingsService
    const staticRoot = tmp()
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html>')
    server = createCompanionServer({
      settings,
      tokens: createCompanionTokens(settings),
      dispatch: async () => ({ ok: true, data: null }),
      version: '0.8.173',
      staticRoot,
      androidApp: () => app
    })
    server.applySettings()
    for (let i = 0; i < 100 && !server.getStatus().running; i++) await new Promise((r) => setTimeout(r, 10))
    return `http://127.0.0.1:${new URL(server.issueToken().url).port}`
  }

  it('serves the APK and its version without a token (phones need it before pairing)', async () => {
    const app = findAndroidApp([bundle('0.8.173', 'apk-bytes')])
    const base = await boot(app)
    const info = await (await fetch(`${base}/api/app-info`)).json()
    expect(info).toEqual({ android: { version: '0.8.173', sizeBytes: 9, path: ANDROID_APP_PATH } })
    const res = await fetch(base + ANDROID_APP_PATH)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/vnd.android.package-archive')
    expect(res.headers.get('content-disposition')).toContain('Family-Skyview-0.8.173.apk')
    expect(await res.text()).toBe('apk-bytes')
    expect(server?.getStatus().androidApp).toEqual({ version: '0.8.173', sizeBytes: 9, path: ANDROID_APP_PATH })
  })

  it('says so when this build has no app', async () => {
    const base = await boot(null)
    expect(await (await fetch(`${base}/api/app-info`)).json()).toEqual({ android: null })
    expect((await fetch(base + ANDROID_APP_PATH)).status).toBe(404)
    expect(server?.getStatus().androidApp).toBeNull()
  })

  it('lets the Android app (https://localhost) read app-info', async () => {
    const base = await boot(findAndroidApp([bundle()]))
    const res = await fetch(`${base}/api/app-info`, { headers: { Origin: 'https://localhost' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost')
  })
})
