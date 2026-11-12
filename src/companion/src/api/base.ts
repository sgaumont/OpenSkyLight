import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

/**
 * Where the kiosk is. The phone web app is served BY the kiosk, so it calls relative paths (/api/…) —
 * no address needed, and that never changes. The Android app (Family Skyview) is bundled inside
 * the phone, so it remembers the kiosk's addresses from pairing: the home Wi-Fi one(s) first, the
 * Tailscale https one for when the phone is out. It uses whichever answers, and checks again when
 * a call can't get through (left the house, came home).
 */
const BASES_KEY = 'osl.kioskBases'
/** How long one address gets to answer the health check. */
const PROBE_MS = 3000
/** Once one address has answered, how long the earlier (preferred) ones still get. */
const PREFER_GRACE_MS = 400

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * On the Android app, also keep the pairing where the app's own (Kotlin) code can read it — Android
 * SharedPreferences "CapacitorStorage" — so a notification's OK / Reply button can call the kiosk
 * without opening the app. Keys: "osl.companionToken", "osl.kioskBases" (JSON array, best first).
 */
export function mirrorToNative(key: string, value: string | null): void {
  if (!isNativeApp()) return
  void (value === null ? Preferences.remove({ key }) : Preferences.set({ key, value })).catch((e) =>
    console.warn('[pairing] native copy', e)
  )
}

export function getBases(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(BASES_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Saved in preference order, without a trailing slash, duplicates dropped. */
export function setBases(bases: string[]): void {
  const clean = [...new Set(bases.map((b) => b.replace(/\/+$/, '')).filter(Boolean))]
  localStorage.setItem(BASES_KEY, JSON.stringify(clean))
  mirrorToNative(BASES_KEY, JSON.stringify(clean))
  current = null
}

export function clearBases(): void {
  localStorage.removeItem(BASES_KEY)
  mirrorToNative(BASES_KEY, null)
  current = null
}

/** The address in use right now; null = not picked yet (or the last one stopped answering). */
let current: string | null = null
let picking: Promise<string> | null = null

async function answers(base: string): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), PROBE_MS)
  try {
    const res = await fetch(`${base}/api/health`, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) return false
    return ((await res.json()) as { app?: string }).app === 'openskylight'
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

/**
 * Ask every saved address at once; take the first in preference order that answers. A later one
 * that answers first still waits a moment, so at home the Wi-Fi address wins over Tailscale.
 */
function pick(bases: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const results: (boolean | undefined)[] = bases.map(() => undefined)
    let grace: ReturnType<typeof setTimeout> | null = null
    let done = false
    const settle = (): void => {
      if (done) return
      const firstOk = results.findIndex((r) => r === true)
      const earlierPending = firstOk >= 0 && results.slice(0, firstOk).some((r) => r === undefined)
      if (firstOk >= 0 && !earlierPending) {
        done = true
        if (grace) clearTimeout(grace)
        return resolve(bases[firstOk])
      }
      if (firstOk >= 0 && !grace) {
        grace = setTimeout(() => {
          done = true
          resolve(bases[results.findIndex((r) => r === true)])
        }, PREFER_GRACE_MS)
      }
      if (results.every((r) => r === false)) {
        done = true
        reject(new TypeError("Can't reach the family display"))
      }
    }
    bases.forEach((b, i) =>
      void answers(b).then((ok) => {
        results[i] = ok
        settle()
      })
    )
  })
}

async function currentBase(): Promise<string> {
  if (current !== null) return current
  const bases = getBases()
  if (bases.length === 0) return ''
  picking ??= pick(bases).finally(() => (picking = null))
  current = await picking
  return current
}

/** The phone came back online or woke up: find the right address again on the next call. */
export function forgetCurrentBase(): void {
  current = null
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', forgetCurrentBase)
}

/**
 * fetch() against the kiosk: relative on the web app; on the Android app, at whichever saved
 * address answers — and if that one can't be reached any more, pick again and retry once.
 */
export async function kioskFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = await currentBase()
  if (base === '') return fetch(path, init)
  try {
    return await fetch(base + path, init)
  } catch (e) {
    if (init.signal?.aborted || !(e instanceof TypeError)) throw e
    current = null
    const again = await currentBase()
    return fetch(again + path, init)
  }
}
