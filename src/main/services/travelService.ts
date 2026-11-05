import { safeStorage } from 'electron'
import { DateTime } from 'luxon'
import type { LeaveTimeDto, TravelStatus } from '@shared/types'
import {
  DAILY_CALL_CAP,
  LOOKAHEAD_HOURS,
  MONTHLY_CALL_CAP,
  departureFor,
  durationToMinutes,
  isRoutableLocation,
  leaveAtMs,
  refreshDue,
  type CachedRoute
} from '@shared/travel'
import type { SettingsService } from './settingsService'
import type { EventService } from './eventService'
import { invalid } from './errors'

const KEY_API = 'travel.apiKeyEnc' // encrypted with the OS key store, never sent to the renderer
const KEY_CACHE = 'travel.cache' // { [occurrenceKey]: CachedRoute }
const KEY_USAGE = 'travel.usage' // { day, dayCount, month, monthCount }
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'
/** How often the kiosk checks whether any trip needs a (re)lookup. */
const TICK_MS = 5 * 60_000

interface Usage {
  day: string
  dayCount: number
  month: string
  monthCount: number
}

function encrypt(plain: string): string {
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain) : Buffer.from(`plain:${plain}`, 'utf8')
  return buf.toString('base64')
}

function decrypt(b64: string): string {
  const buf = Buffer.from(b64, 'base64')
  const s = buf.toString('utf8')
  return s.startsWith('plain:') ? s.slice(6) : safeStorage.decryptString(buf)
}

/** One drive lookup: minutes, null = no route there, or throws on a key/quota/network problem. */
export type RouteLookup = (apiKey: string, origin: string, destination: string, departAtMs: number) => Promise<number | null>

/** Google Routes API: traffic-aware drive time for a departure time. */
export const googleRouteLookup: RouteLookup = async (apiKey, origin, destination, departAtMs) => {
  const res = await fetch(ROUTES_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.duration'
    },
    body: JSON.stringify({
      origin: { address: origin },
      destination: { address: destination },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      departureTime: new Date(departAtMs).toISOString(),
      regionCode: 'ca'
    })
  })
  const body = (await res.json().catch(() => ({}))) as {
    routes?: { duration?: string }[]
    error?: { message?: string; status?: string }
  }
  if (!res.ok) {
    // an address Google can't place is "no route", not a broken key
    if (res.status === 400 && /not found|could not be geocoded|invalid.*(origin|destination)/i.test(body.error?.message ?? '')) return null
    throw new Error(body.error?.message ?? `Google Routes error ${res.status}`)
  }
  return durationToMinutes(body.routes?.[0]?.duration)
}

export function createTravelService(deps: {
  settings: SettingsService
  events: EventService
  onChange: () => void
  lookup?: RouteLookup
  now?: () => number
}) {
  const lookup = deps.lookup ?? googleRouteLookup
  const now = deps.now ?? Date.now
  let lastError: string | null = null
  let timer: NodeJS.Timeout | null = null
  let running = false

  const readJson = <T>(key: string, fallback: T): T => {
    try {
      const raw = deps.settings.getRaw(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  }
  const getKey = (): string | null => {
    const enc = deps.settings.getRaw(KEY_API)
    if (!enc) return null
    try {
      return decrypt(enc)
    } catch {
      return null
    }
  }

  function usage(): Usage {
    const t = DateTime.fromMillis(now())
    const day = t.toISODate()!
    const month = t.toFormat('yyyy-MM')
    const u = readJson<Usage>(KEY_USAGE, { day, dayCount: 0, month, monthCount: 0 })
    return {
      day,
      dayCount: u.day === day ? u.dayCount : 0,
      month,
      monthCount: u.month === month ? u.monthCount : 0
    }
  }
  const underCap = (u: Usage): boolean => u.dayCount < DAILY_CALL_CAP && u.monthCount < MONTHLY_CALL_CAP
  function count(): void {
    const u = usage()
    deps.settings.setRaw(KEY_USAGE, JSON.stringify({ ...u, dayCount: u.dayCount + 1, monthCount: u.monthCount + 1 }))
  }

  /** Upcoming timed events with a place to drive to. */
  function upcoming() {
    const t = now()
    const s = deps.settings.getAll()
    const homeCity = s.weather?.label.split(',')[0] ?? ''
    return deps.events
      .getOccurrences({ start: new Date(t).toISOString(), end: new Date(t + LOOKAHEAD_HOURS * 3600_000).toISOString() })
      .filter((o) => !o.allDay && Date.parse(o.start) > t && isRoutableLocation(o.location, homeCity))
  }

  /** Look up whatever is due. Returns how many lookups were made. */
  async function refresh(): Promise<number> {
    const s = deps.settings.getAll().travel
    const apiKey = getKey()
    if (!s.enabled || !s.homeAddress.trim() || !apiKey || running) return 0
    running = true
    let made = 0
    try {
      const cache = readJson<Record<string, CachedRoute>>(KEY_CACHE, {})
      const occs = upcoming()
      // forget trips that are over or gone
      const live = new Set(occs.map((o) => o.key))
      for (const k of Object.keys(cache)) if (!live.has(k)) delete cache[k]
      for (const o of occs) {
        const startMs = Date.parse(o.start)
        const location = o.location!.trim()
        if (!refreshDue(now(), startMs, s.bufferMinutes, cache[o.key], location)) continue
        if (!underCap(usage())) {
          lastError = 'Daily or monthly lookup limit reached — leave-by times pause until it resets'
          break
        }
        const depart = departureFor(now(), startMs, s.bufferMinutes, cache[o.key]?.location === location ? cache[o.key] : undefined)
        count()
        made += 1
        try {
          const minutes = await lookup(apiKey, s.homeAddress.trim(), location, depart)
          cache[o.key] = { location, minutes, fetchedAt: now() }
          lastError = null
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
          break // a bad key or quota problem: stop until the next tick
        }
      }
      deps.settings.setRaw(KEY_CACHE, JSON.stringify(cache))
      if (made > 0) deps.onChange()
    } finally {
      running = false
    }
    return made
  }

  function leaveTimes(): LeaveTimeDto[] {
    const s = deps.settings.getAll().travel
    if (!s.enabled) return []
    const cache = readJson<Record<string, CachedRoute>>(KEY_CACHE, {})
    const out: LeaveTimeDto[] = []
    for (const o of upcoming()) {
      const c = cache[o.key]
      if (!c || c.minutes === null || c.location !== o.location!.trim()) continue
      out.push({
        key: o.key,
        title: o.title,
        location: c.location,
        start: o.start,
        leaveAt: new Date(leaveAtMs(Date.parse(o.start), c.minutes, s.bufferMinutes)).toISOString(),
        driveMinutes: c.minutes
      })
    }
    return out.sort((a, b) => a.leaveAt.localeCompare(b.leaveAt))
  }

  function status(): TravelStatus {
    const u = usage()
    return {
      keySet: getKey() !== null,
      callsToday: u.dayCount,
      callsThisMonth: u.monthCount,
      dailyCap: DAILY_CALL_CAP,
      monthlyCap: MONTHLY_CALL_CAP,
      lastError
    }
  }

  function setApiKey(apiKey: string | null): void {
    if (apiKey === null) deps.settings.deleteRaw(KEY_API)
    else deps.settings.setRaw(KEY_API, encrypt(apiKey.trim()))
    deps.settings.deleteRaw(KEY_CACHE)
    lastError = null
    void refresh()
  }

  /** One live lookup from home now (counts toward the caps). */
  async function test(destination: string): Promise<{ minutes: number | null }> {
    const apiKey = getKey()
    const home = deps.settings.getAll().travel.homeAddress.trim()
    if (!apiKey) throw invalid('Add the Google Maps API key first')
    if (!home) throw invalid('Add your home address first')
    if (!underCap(usage())) throw invalid('Lookup limit reached for today')
    count()
    try {
      const minutes = await lookup(apiKey, home, destination, now() + 60_000)
      lastError = null
      return { minutes }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      throw invalid(lastError)
    }
  }

  function start(): void {
    if (timer) return
    timer = setInterval(() => void refresh(), TICK_MS)
    setTimeout(() => void refresh(), 10_000)
  }
  function stop(): void {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { refresh, leaveTimes, status, setApiKey, test, start, stop }
}

export type TravelService = ReturnType<typeof createTravelService>
