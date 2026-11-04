import { DateTime } from 'luxon'
import { isoUtc } from '@shared/dates'
import { zoneFor } from '@shared/zones'

/**
 * Pure mapping between Google Calendar API event resources and OpenSkyLight
 * event rows. No Electron or network imports — fully unit-testable.
 */

export interface GTime {
  date?: string | null
  dateTime?: string | null
  timeZone?: string | null
}

export interface GEventItem {
  id?: string | null
  status?: string | null
  etag?: string | null
  iCalUID?: string | null
  summary?: string | null
  description?: string | null
  location?: string | null
  start?: GTime | null
  end?: GTime | null
  recurrence?: string[] | null
  recurringEventId?: string | null
  originalStartTime?: GTime | null
  updated?: string | null
  extendedProperties?: { private?: Record<string, string> | null } | null
}

export function gTimeToInstant(t: GTime, fallbackTz: string): { iso: string; allDay: boolean; tz: string } {
  if (t.date) {
    const dt = DateTime.fromISO(t.date, { zone: zoneFor(fallbackTz) }).startOf('day')
    return { iso: isoUtc(dt), allDay: true, tz: fallbackTz }
  }
  const tz = t.timeZone ?? fallbackTz
  const dt = DateTime.fromISO(t.dateTime!, { setZone: true })
  return { iso: isoUtc(dt), allDay: false, tz }
}

function parseDateValue(value: string, tzid: string | null, eventTz: string): string {
  if (/^\d{8}$/.test(value)) {
    return isoUtc(DateTime.fromFormat(value, 'yyyyMMdd', { zone: zoneFor(tzid ?? eventTz) }).startOf('day'))
  }
  if (value.endsWith('Z')) {
    return isoUtc(DateTime.fromFormat(value, "yyyyMMdd'T'HHmmss'Z'", { zone: 'utc' }))
  }
  return isoUtc(DateTime.fromFormat(value, "yyyyMMdd'T'HHmmss", { zone: zoneFor(tzid ?? eventTz) }))
}

/** Parse Google's `recurrence` string array (RRULE / EXDATE / RDATE lines). */
export function parseGoogleRecurrence(
  lines: string[] | null | undefined,
  eventTz: string
): { rrule: string | null; exdates: string[]; rdates: string[] } {
  let rrule: string | null = null
  const exdates: string[] = []
  const rdates: string[] = []
  for (const line of lines ?? []) {
    if (/^RRULE:/i.test(line)) {
      if (!rrule) rrule = line.slice(6)
      continue
    }
    const m = /^(EXDATE|RDATE)([^:]*):(.*)$/i.exec(line)
    if (!m) continue
    const [, name, paramStr, valueStr] = m
    const tzid = /TZID=([^;:]+)/i.exec(paramStr)?.[1] ?? null
    const target = name.toUpperCase() === 'EXDATE' ? exdates : rdates
    for (const value of valueStr.split(',')) {
      const v = value.trim()
      if (!v) continue
      try {
        target.push(parseDateValue(v, tzid, eventTz))
      } catch {
        // skip unparseable entries rather than failing the whole event
      }
    }
  }
  return { rrule, exdates, rdates }
}

/** Google's id for a single instance of a recurring event. */
export function instanceProviderId(masterProviderId: string, originalStartAtIso: string, allDay: boolean): string {
  const dt = DateTime.fromISO(originalStartAtIso, { zone: 'utc' })
  const stamp = allDay ? dt.toFormat('yyyyMMdd') : dt.toFormat("yyyyMMdd'T'HHmmss'Z'")
  return `${masterProviderId}_${stamp}`
}

export interface MappedEvent {
  providerEventId: string
  etag: string | null
  icalUid: string | null
  title: string
  description: string | null
  location: string | null
  startAt: string
  endAt: string
  tz: string
  allDay: boolean
  rrule: string | null
  exdates: string | null // JSON
  rdates: string | null // JSON
  status: 'confirmed' | 'cancelled'
  remoteUpdatedAt: string | null
  personIds: string[]
  /** provider id of the master series when this is an exception instance */
  recurringProviderId: string | null
  originalStartAt: string | null
}

export function gItemToMapped(item: GEventItem, deviceTz: string): MappedEvent | null {
  if (!item.id) return null
  const cancelled = item.status === 'cancelled'
  // cancelled items come without start/end — synthesize placeholders
  const start = item.start ? gTimeToInstant(item.start, deviceTz) : null
  const end = item.end ? gTimeToInstant(item.end, deviceTz) : null
  if (!cancelled && (!start || !end)) return null

  const tz = start?.tz ?? deviceTz
  const rec = parseGoogleRecurrence(item.recurrence, tz)
  const peopleRaw = item.extendedProperties?.private?.osl_people ?? ''
  const originalStart = item.originalStartTime ? gTimeToInstant(item.originalStartTime, deviceTz).iso : null

  return {
    providerEventId: item.id,
    etag: item.etag ?? null,
    icalUid: item.iCalUID ?? null,
    title: item.summary ?? '(no title)',
    description: item.description ?? null,
    location: item.location ?? null,
    startAt: start?.iso ?? originalStart ?? '1970-01-01T00:00:00Z',
    endAt: end?.iso ?? originalStart ?? '1970-01-01T00:00:00Z',
    tz,
    allDay: start?.allDay ?? false,
    rrule: rec.rrule,
    exdates: rec.exdates.length > 0 ? JSON.stringify(rec.exdates) : null,
    rdates: rec.rdates.length > 0 ? JSON.stringify(rec.rdates) : null,
    status: cancelled ? 'cancelled' : 'confirmed',
    remoteUpdatedAt: item.updated ?? null,
    personIds: peopleRaw.split(',').map((s) => s.trim()).filter(Boolean),
    recurringProviderId: item.recurringEventId ?? null,
    originalStartAt: originalStart
  }
}

export interface RowForPush {
  title: string
  description: string | null
  location: string | null
  startAt: string
  endAt: string
  tz: string
  allDay: boolean
  rrule: string | null
  exdates: string | null
  rdates: string | null
  personIds: string[]
}

function formatExValues(isoList: string[], tz: string, allDay: boolean): { params: string; values: string } {
  if (allDay) {
    return {
      params: ';VALUE=DATE',
      values: isoList.map((iso) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz).toFormat('yyyyMMdd')).join(',')
    }
  }
  return {
    params: `;TZID=${tz}`,
    values: isoList
      .map((iso) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz).toFormat("yyyyMMdd'T'HHmmss"))
      .join(',')
  }
}

/** Build the Google event resource for insert/patch from a local row. */
export function rowToGResource(row: RowForPush): Record<string, unknown> {
  const start = DateTime.fromISO(row.startAt, { zone: 'utc' }).setZone(row.tz)
  const end = DateTime.fromISO(row.endAt, { zone: 'utc' }).setZone(row.tz)

  const resource: Record<string, unknown> = {
    summary: row.title,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    start: row.allDay
      ? { date: start.toISODate() }
      : { dateTime: start.toISO({ suppressMilliseconds: true }), timeZone: row.tz },
    end: row.allDay
      ? { date: end.toISODate() }
      : { dateTime: end.toISO({ suppressMilliseconds: true }), timeZone: row.tz },
    extendedProperties: { private: { osl_people: row.personIds.join(',') } }
  }

  if (row.rrule) {
    const lines = [`RRULE:${row.rrule}`]
    const exdates = safeParse(row.exdates)
    const rdates = safeParse(row.rdates)
    if (exdates.length > 0) {
      const { params, values } = formatExValues(exdates, row.tz, row.allDay)
      lines.push(`EXDATE${params}:${values}`)
    }
    if (rdates.length > 0) {
      const { params, values } = formatExValues(rdates, row.tz, row.allDay)
      lines.push(`RDATE${params}:${values}`)
    }
    resource.recurrence = lines
  } else {
    resource.recurrence = []
  }
  return resource
}

function safeParse(s: string | null): string[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
