/**
 * "Leave by" times: pure rules shared by the main-process travel service and its tests.
 * Drive times come from the Google Routes API, from home to an event's location.
 */

/** Only look up events starting within this many hours. */
export const LOOKAHEAD_HOURS = 24
/** Hard caps on Routes API calls, under Google's 5,000/month free traffic-aware tier. */
export const DAILY_CALL_CAP = 250
export const MONTHLY_CALL_CAP = 4000
/** Until we know the drive, assume this much (only used to pick the first departure time). */
const GUESS_MINUTES = 30

const ONLINE = /(teams|zoom|google meet|meet\.google|webex|skype|https?:\/\/|www\.|online|virtual|phone call|conference call)/i

/**
 * Worth routing to: a real place, not an online meeting or just a city name.
 * ("2051 Leger Rd Edmonton…", "George H. Luck School" yes; "Microsoft Teams Meeting", "Edmonton" no.)
 */
export function isRoutableLocation(location: string | null | undefined, homeCity = ''): boolean {
  const loc = (location ?? '').trim()
  if (loc.length < 4) return false
  if (ONLINE.test(loc)) return false
  const bare = loc.toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim()
  const city = homeCity.toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim()
  // just the city (with or without a province/country) says nothing about where to drive
  if (city && (bare === city || (bare.startsWith(`${city} `) && bare.split(' ').length <= 3))) return false
  return true
}

/** When to leave: start − drive − buffer. */
export function leaveAtMs(startMs: number, driveMinutes: number, bufferMinutes: number): number {
  return startMs - (driveMinutes + bufferMinutes) * 60_000
}

export interface CachedRoute {
  /** the location string the drive was looked up for (a changed location means look again) */
  location: string
  /** whole minutes, or null = Google couldn't route there */
  minutes: number | null
  fetchedAt: number
}

/**
 * Whether to (re)look up an event's drive now. Frugal: once when it comes within a day, then
 * hourly from 3 h before leaving, and every 20 min in the last 90 min — about 5 calls a trip.
 * Nothing once it's time to leave. Unroutable places are retried a day later.
 */
export function refreshDue(
  nowMs: number,
  startMs: number,
  bufferMinutes: number,
  cached: CachedRoute | undefined,
  location: string
): boolean {
  if (startMs <= nowMs || startMs - nowMs > LOOKAHEAD_HOURS * 3600_000) return false
  if (!cached || cached.location !== location) return true
  const age = nowMs - cached.fetchedAt
  if (cached.minutes === null) return age > 24 * 3600_000
  const toLeave = leaveAtMs(startMs, cached.minutes, bufferMinutes) - nowMs
  if (toLeave <= 0) return false
  if (toLeave <= 90 * 60_000) return age > 20 * 60_000
  if (toLeave <= 180 * 60_000) return age > 60 * 60_000
  return age > 6 * 3600_000
}

/** The departure time to ask Google about: when we'd leave (never in the past). */
export function departureFor(nowMs: number, startMs: number, bufferMinutes: number, cached: CachedRoute | undefined): number {
  const drive = cached?.minutes ?? GUESS_MINUTES
  return Math.max(nowMs + 60_000, leaveAtMs(startMs, drive, bufferMinutes))
}

/** Google Routes "1234s" → whole minutes, rounded up. */
export function durationToMinutes(duration: string | undefined): number | null {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(duration ?? '')
  if (!m) return null
  return Math.max(1, Math.ceil(Number(m[1]) / 60))
}
