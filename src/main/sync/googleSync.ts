import { calendar as createCalendarClient, type calendar_v3 } from '@googleapis/calendar'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { AppDb } from '../db/client'
import { calendars, eventPeople, events, people } from '../db/schema'
import type { GoogleAuth } from './googleAuth'
import { gItemToMapped, type GEventItem, type MappedEvent } from './googleMap'
import { uuidv7 } from '@shared/uuid'
import { isoUtc } from '@shared/dates'
import { notFound } from '../services/errors'

type CalendarRow = typeof calendars.$inferSelect

export interface RemoteCalendarInfo {
  id: string
  name: string
  color: string
  primary: boolean
  readOnly: boolean
  selected: boolean
}

export function httpStatus(err: unknown): number | null {
  const e = err as { status?: number; code?: number | string; response?: { status?: number } }
  if (typeof e?.status === 'number') return e.status
  if (typeof e?.response?.status === 'number') return e.response.status
  if (typeof e?.code === 'number') return e.code
  return null
}

export function createGoogleSync(deps: { db: AppDb; auth: GoogleAuth; deviceTz: () => string }) {
  const { db, auth } = deps

  function api(accountId: string): calendar_v3.Calendar {
    // cast: @googleapis/calendar bundles its own google-auth-library typings,
    // which are structurally identical but nominally incompatible
    const client = auth.getAuthedClient(accountId) as unknown as calendar_v3.Options['auth']
    return createCalendarClient({ version: 'v3', auth: client })
  }

  async function listRemoteCalendars(accountId: string): Promise<RemoteCalendarInfo[]> {
    const res = await api(accountId).calendarList.list({ maxResults: 250 })
    const existing = db
      .select()
      .from(calendars)
      .where(and(eq(calendars.googleAccountId, accountId), isNull(calendars.deletedAt)))
      .all()
    const selectedIds = new Set(existing.map((c) => c.googleCalendarId))
    return (res.data.items ?? []).map((item) => ({
      id: item.id!,
      name: item.summaryOverride ?? item.summary ?? item.id!,
      color: item.backgroundColor ?? '#0091FF',
      primary: item.primary ?? false,
      readOnly: !(item.accessRole === 'owner' || item.accessRole === 'writer'),
      selected: selectedIds.has(item.id!)
    }))
  }

  function setCalendarSelected(input: {
    accountId: string
    googleCalendarId: string
    name: string
    color: string
    readOnly: boolean
    selected: boolean
  }): void {
    const existing = db
      .select()
      .from(calendars)
      .where(
        and(
          eq(calendars.googleAccountId, input.accountId),
          eq(calendars.googleCalendarId, input.googleCalendarId),
          isNull(calendars.deletedAt)
        )
      )
      .all()
    if (input.selected) {
      if (existing.length > 0) return
      db.insert(calendars)
        .values({
          id: uuidv7(),
          provider: 'google',
          googleAccountId: input.accountId,
          googleCalendarId: input.googleCalendarId,
          name: input.name,
          color: input.color,
          readOnly: input.readOnly,
          visible: true
        })
        .run()
    } else if (existing.length > 0) {
      const now = isoUtc(DateTime.utc())
      db.transaction((tx) => {
        tx.update(events)
          .set({ deletedAt: now })
          .where(and(eq(events.calendarId, existing[0].id), isNull(events.deletedAt)))
          .run()
        tx.update(calendars).set({ deletedAt: now }).where(eq(calendars.id, existing[0].id)).run()
      })
    }
  }

  /** Pull changes for one Google calendar. Returns true if anything changed locally. */
  async function pullCalendar(cal: CalendarRow): Promise<boolean> {
    if (!cal.googleAccountId || !cal.googleCalendarId) throw notFound('Google calendar binding')
    const client = api(cal.googleAccountId)
    const fullSync = !cal.syncToken

    const items: GEventItem[] = []
    let pageToken: string | undefined
    let nextSyncToken: string | undefined
    try {
      do {
        const res = await client.events.list({
          calendarId: cal.googleCalendarId,
          singleEvents: false,
          maxResults: 250,
          pageToken,
          ...(cal.syncToken
            ? { syncToken: cal.syncToken }
            : { timeMin: DateTime.utc().minus({ years: 1 }).toISO() })
        })
        items.push(...((res.data.items ?? []) as GEventItem[]))
        pageToken = res.data.nextPageToken ?? undefined
        if (res.data.nextSyncToken) nextSyncToken = res.data.nextSyncToken
      } while (pageToken)
    } catch (err) {
      if (httpStatus(err) === 410) {
        // sync token expired — full resync
        db.update(calendars).set({ syncToken: null }).where(eq(calendars.id, cal.id)).run()
        return pullCalendar({ ...cal, syncToken: null })
      }
      throw err
    }

    const changed = applyItems(cal, items, fullSync)
    db.update(calendars)
      .set({
        syncToken: nextSyncToken ?? cal.syncToken,
        lastSyncedAt: isoUtc(DateTime.utc()),
        syncError: null
      })
      .where(eq(calendars.id, cal.id))
      .run()
    return changed
  }

  /** Apply pulled items to the local store. Masters first, then exception instances. */
  function applyItems(cal: CalendarRow, items: GEventItem[], fullSync: boolean): boolean {
    if (items.length === 0 && !fullSync) return false
    const deviceTz = deps.deviceTz()
    const knownPeople = new Set(db.select({ id: people.id }).from(people).all().map((p) => p.id))
    let changed = false

    const mapped = items
      .map((item) => gItemToMapped(item, deviceTz))
      .filter((m): m is MappedEvent => m !== null)
    const masters = mapped.filter((m) => !m.recurringProviderId)
    const exceptions = mapped.filter((m) => m.recurringProviderId)

    db.transaction((tx) => {
      const seen = new Set<string>()

      const upsertOne = (m: MappedEvent, recurringLocalId: string | null): void => {
        seen.add(m.providerEventId)
        const [existing] = tx
          .select()
          .from(events)
          .where(and(eq(events.calendarId, cal.id), eq(events.providerEventId, m.providerEventId)))
          .all()

        // Local unsynced edits win until the push path resolves them
        if (existing?.dirty) return

        if (m.status === 'cancelled' && !m.recurringProviderId) {
          if (existing && !existing.deletedAt) {
            const now = isoUtc(DateTime.utc())
            tx.update(events).set({ deletedAt: now }).where(eq(events.id, existing.id)).run()
            tx.update(events)
              .set({ deletedAt: now })
              .where(and(eq(events.recurringEventId, existing.id), isNull(events.deletedAt)))
              .run()
            changed = true
          }
          return
        }

        const fields = {
          title: m.title,
          description: m.description,
          location: m.location,
          startAt: m.startAt,
          endAt: m.endAt,
          tz: m.tz,
          allDay: m.allDay,
          rrule: m.rrule,
          exdates: m.exdates,
          rdates: m.rdates,
          etag: m.etag,
          icalUid: m.icalUid,
          status: m.status,
          recurringEventId: recurringLocalId,
          originalStartAt: m.originalStartAt,
          remoteUpdatedAt: m.remoteUpdatedAt,
          deletedAt: null,
          updatedAt: isoUtc(DateTime.utc())
        }

        let localId: string
        if (existing) {
          // unchanged remotely — unless an all-day event was stored in another time zone
          const sameTz = !m.allDay || existing.tz === m.tz
          if (existing.etag && m.etag && existing.etag === m.etag && !existing.deletedAt && sameTz) return
          tx.update(events).set(fields).where(eq(events.id, existing.id)).run()
          localId = existing.id
        } else {
          localId = uuidv7()
          tx.insert(events)
            .values({
              id: localId,
              calendarId: cal.id,
              providerEventId: m.providerEventId,
              dirty: false,
              createdAt: isoUtc(DateTime.utc()),
              ...fields
            })
            .run()
        }
        const valid = m.personIds.filter((id) => knownPeople.has(id))
        tx.delete(eventPeople).where(eq(eventPeople.eventId, localId)).run()
        for (const personId of valid) tx.insert(eventPeople).values({ eventId: localId, personId }).run()
        changed = true
      }

      for (const m of masters) upsertOne(m, null)

      for (const m of exceptions) {
        const [master] = tx
          .select()
          .from(events)
          .where(and(eq(events.calendarId, cal.id), eq(events.providerEventId, m.recurringProviderId!)))
          .all()
        if (!master) continue // master outside our window — orphan instance, skip
        upsertOne(m, master.id)
      }

      // Full sync: anything we did not see no longer exists remotely
      if (fullSync) {
        const stale = tx
          .select()
          .from(events)
          .where(and(eq(events.calendarId, cal.id), isNull(events.deletedAt)))
          .all()
          .filter((row) => row.providerEventId && !seen.has(row.providerEventId) && !row.dirty)
        if (stale.length > 0) {
          tx.update(events)
            .set({ deletedAt: isoUtc(DateTime.utc()) })
            .where(inArray(events.id, stale.map((r) => r.id)))
            .run()
          changed = true
        }
      }
    })
    return changed
  }

  return { listRemoteCalendars, setCalendarSelected, pullCalendar, api }
}

export type GoogleSync = ReturnType<typeof createGoogleSync>
