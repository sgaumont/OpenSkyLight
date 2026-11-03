import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { calendars, eventPeople, events } from '../db/schema'
import { uuidv7 } from '@shared/uuid'
import { fromIso, isoUtc } from '@shared/dates'
import { buildRRuleString, parseRRuleString, withUntilInstant, withoutEndCap } from '@shared/recurrence/build'
import {
  expandOccurrences,
  occurrenceTimes,
  type ExceptionLike,
  type MasterEventLike
} from '@shared/recurrence/expand'
import type {
  EventCreateInput,
  EventDeleteInput,
  EventDto,
  EventPatch,
  EventUpdateInput,
  OccurrenceDto
} from '@shared/types'
import { invalid, notFound } from './errors'
import { DateTime } from 'luxon'

type EventRow = typeof events.$inferSelect
type Tx = Parameters<Parameters<AppDb['transaction']>[0]>[0]
type DbOrTx = AppDb | Tx

function parseArr(s: string | null): string[] | null {
  if (!s) return null
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

function asMasterLike(row: EventRow): MasterEventLike {
  return {
    id: row.id,
    startAt: row.startAt,
    endAt: row.endAt,
    tz: row.tz,
    allDay: row.allDay,
    rrule: row.rrule,
    rdates: parseArr(row.rdates),
    exdates: parseArr(row.exdates)
  }
}

function asExceptionLike(row: EventRow): ExceptionLike {
  return {
    id: row.id,
    recurringEventId: row.recurringEventId!,
    originalStartAt: row.originalStartAt!,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status
  }
}

/**
 * An all-day event's stored instants are midnights in the zone it was saved in (`tz`).
 * Re-anchor them to midnights in `zone`, so a later change of the device's time zone
 * never spills the event onto the neighbouring day.
 */
export function allDayInZone(startIso: string, endIso: string, tz: string, zone: string): { start: string; end: string } {
  const at = (iso: string) =>
    isoUtc(DateTime.fromISO(DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz).toISODate()!, { zone }))
  return { start: at(startIso), end: at(endIso) }
}

export function createEventService(db: AppDb, deviceTz: () => string = () => DateTime.local().zoneName ?? 'UTC') {
  const now = () => isoUtc(DateTime.utc())
  const norm = (iso: string) => isoUtc(fromIso(iso))

  function getRow(id: string): EventRow {
    const [row] = db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).all()
    if (!row) throw notFound('Event')
    return row
  }

  function getCalendarOrThrow(id: string) {
    const [cal] = db.select().from(calendars).where(and(eq(calendars.id, id), isNull(calendars.deletedAt))).all()
    if (!cal) throw notFound('Calendar')
    return cal
  }

  function assertWritable(row: EventRow): void {
    const cal = getCalendarOrThrow(row.calendarId)
    if (cal.readOnly) throw invalid('This calendar is read-only')
  }

  function peopleFor(eventIds: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>()
    if (eventIds.length === 0) return map
    const rows = db.select().from(eventPeople).where(inArray(eventPeople.eventId, eventIds)).all()
    for (const r of rows) {
      const arr = map.get(r.eventId) ?? []
      arr.push(r.personId)
      map.set(r.eventId, arr)
    }
    return map
  }

  function setPeople(tx: DbOrTx, eventId: string, personIds: string[]): void {
    tx.delete(eventPeople).where(eq(eventPeople.eventId, eventId)).run()
    for (const personId of [...new Set(personIds)]) {
      tx.insert(eventPeople).values({ eventId, personId }).run()
    }
  }

  /** Compute startAt/endAt updates, preserving duration when only one side changes. */
  function timesPatch(
    row: Pick<EventRow, 'startAt' | 'endAt'>,
    changes: Pick<EventPatch, 'start' | 'end' | 'allDay'>,
    allDay: boolean
  ): { startAt?: string; endAt?: string } {
    if (changes.start === undefined && changes.end === undefined) return {}
    const start = fromIso(changes.start ?? row.startAt)
    let end = changes.end !== undefined ? fromIso(changes.end) : null
    if (!end) {
      const durMs = fromIso(row.endAt).toMillis() - fromIso(row.startAt).toMillis()
      end = start.plus({ milliseconds: durMs })
    }
    if (end <= start) {
      if (allDay) end = start.plus({ days: 1 })
      else throw invalid('End must be after start')
    }
    return { startAt: isoUtc(start), endAt: isoUtc(end) }
  }

  function fieldPatch(changes: EventPatch): Partial<typeof events.$inferInsert> {
    const patch: Partial<typeof events.$inferInsert> = {}
    if (changes.title !== undefined) patch.title = changes.title
    if (changes.description !== undefined) patch.description = changes.description
    if (changes.location !== undefined) patch.location = changes.location
    if (changes.tz !== undefined) patch.tz = changes.tz
    if (changes.allDay !== undefined) patch.allDay = changes.allDay
    return patch
  }

  function toDto(row: EventRow, personIds: string[]): EventDto {
    const cal = getCalendarOrThrow(row.calendarId)
    return {
      id: row.id,
      calendarId: row.calendarId,
      title: row.title,
      description: row.description,
      location: row.location,
      startAt: row.startAt,
      endAt: row.endAt,
      tz: row.tz,
      allDay: row.allDay,
      rrule: row.rrule,
      recurrence: row.rrule ? parseRRuleString(row.rrule, row.tz) : null,
      recurringEventId: row.recurringEventId,
      originalStartAt: row.originalStartAt,
      status: row.status,
      readOnly: cal.readOnly,
      personIds
    }
  }

  function getEvent(id: string): EventDto | null {
    try {
      const row = getRow(id)
      return toDto(row, peopleFor([id]).get(id) ?? [])
    } catch {
      return null
    }
  }

  function getOccurrences(query: { start: string; end: string }): OccurrenceDto[] {
    const windowStart = norm(query.start)
    const windowEnd = norm(query.end)
    const cals = db
      .select()
      .from(calendars)
      .where(and(isNull(calendars.deletedAt), eq(calendars.visible, true)))
      .all()
    if (cals.length === 0) return []
    const calIds = cals.map((c) => c.id)
    const readOnlyByCal = new Map(cals.map((c) => [c.id, c.readOnly]))

    const masters = db
      .select()
      .from(events)
      .where(
        and(
          inArray(events.calendarId, calIds),
          isNull(events.deletedAt),
          isNull(events.recurringEventId),
          eq(events.status, 'confirmed'),
          lt(events.startAt, windowEnd)
        )
      )
      .all()
      // non-recurring rows must also overlap the window start
      .filter((row) => row.rrule !== null || row.endAt > windowStart)

    const recurringIds = masters.filter((m) => m.rrule !== null).map((m) => m.id)
    const exceptionRows =
      recurringIds.length > 0
        ? db
            .select()
            .from(events)
            .where(and(inArray(events.recurringEventId, recurringIds), isNull(events.deletedAt)))
            .all()
        : []
    const exceptionsByMaster = new Map<string, EventRow[]>()
    for (const ex of exceptionRows) {
      const arr = exceptionsByMaster.get(ex.recurringEventId!) ?? []
      arr.push(ex)
      exceptionsByMaster.set(ex.recurringEventId!, arr)
    }

    const rowById = new Map<string, EventRow>()
    for (const r of [...masters, ...exceptionRows]) rowById.set(r.id, r)
    const peopleMap = peopleFor([...rowById.keys()])

    const out: OccurrenceDto[] = []
    const zone = deviceTz()
    for (const master of masters) {
      const exceptions = (exceptionsByMaster.get(master.id) ?? []).map(asExceptionLike)
      const expanded = expandOccurrences(asMasterLike(master), exceptions, windowStart, windowEnd)
      for (const occ of expanded) {
        const row = rowById.get(occ.eventId)!
        const { start, end } = row.allDay
          ? allDayInZone(occ.start, occ.end, row.tz, zone)
          : { start: occ.start, end: occ.end }
        if (start >= windowEnd || end <= windowStart) continue
        const personIds =
          peopleMap.get(occ.eventId) ?? (occ.isException ? (peopleMap.get(occ.masterId) ?? []) : [])
        out.push({
          key: `${occ.eventId}|${occ.occurrenceStart}`,
          eventId: occ.eventId,
          masterId: occ.masterId,
          calendarId: row.calendarId,
          title: row.title,
          location: row.location,
          start,
          end,
          allDay: row.allDay,
          isRecurring: master.rrule !== null,
          readOnly: readOnlyByCal.get(row.calendarId) ?? false,
          occurrenceStart: occ.occurrenceStart,
          personIds
        })
      }
    }
    out.sort((a, b) => (a.start === b.start ? a.title.localeCompare(b.title) : a.start < b.start ? -1 : 1))
    return out
  }

  function normalizeCreateTimes(input: EventCreateInput): { startAt: string; endAt: string } {
    if (input.allDay) {
      const start = fromIso(input.start).setZone(input.tz).startOf('day')
      let end = fromIso(input.end).setZone(input.tz).startOf('day')
      if (end <= start) end = start.plus({ days: 1 })
      return { startAt: isoUtc(start), endAt: isoUtc(end) }
    }
    const start = fromIso(input.start)
    const end = fromIso(input.end)
    if (end <= start) throw invalid('End must be after start')
    return { startAt: isoUtc(start), endAt: isoUtc(end) }
  }

  function create(input: EventCreateInput): EventDto {
    const cal = getCalendarOrThrow(input.calendarId)
    if (cal.readOnly) throw invalid('This calendar is read-only')
    const { startAt, endAt } = normalizeCreateTimes(input)
    const id = uuidv7()
    const ts = now()
    db.transaction((tx) => {
      tx.insert(events)
        .values({
          id,
          calendarId: input.calendarId,
          title: input.title,
          description: input.description ?? null,
          location: input.location ?? null,
          startAt,
          endAt,
          tz: input.tz,
          allDay: input.allDay,
          rrule: input.recurrence ? buildRRuleString(input.recurrence, input.tz) : null,
          status: 'confirmed',
          dirty: true,
          createdAt: ts,
          updatedAt: ts
        })
        .run()
      setPeople(tx, id, input.personIds)
    })
    return getEvent(id)!
  }

  function applyDirect(tx: DbOrTx, row: EventRow, changes: EventPatch): void {
    const patch = {
      ...fieldPatch(changes),
      ...timesPatch(row, changes, changes.allDay ?? row.allDay),
      updatedAt: now(),
      dirty: true
    }
    tx.update(events).set(patch).where(eq(events.id, row.id)).run()
    if (changes.personIds !== undefined) setPeople(tx, row.id, changes.personIds)
  }

  /** scope 'all' (or non-recurring): apply patch to the master, shifting times by the edited delta. */
  function applyToMaster(row: EventRow, changes: EventPatch, occurrenceStart?: string): void {
    db.transaction((tx) => {
      const patch: Partial<typeof events.$inferInsert> = {
        ...fieldPatch(changes),
        updatedAt: now(),
        dirty: true
      }
      if (changes.start !== undefined) {
        // Shift the whole series by how far the edited occurrence moved
        const ref = occurrenceStart ? norm(occurrenceStart) : row.startAt
        const deltaMs = fromIso(changes.start).toMillis() - fromIso(ref).toMillis()
        const newStart = fromIso(row.startAt).plus({ milliseconds: deltaMs })
        const durMs =
          changes.end !== undefined
            ? fromIso(changes.end).toMillis() - fromIso(changes.start).toMillis()
            : fromIso(row.endAt).toMillis() - fromIso(row.startAt).toMillis()
        if (durMs <= 0 && !(changes.allDay ?? row.allDay)) throw invalid('End must be after start')
        patch.startAt = isoUtc(newStart)
        patch.endAt = isoUtc(newStart.plus({ milliseconds: Math.max(durMs, 1) }))
      } else if (changes.end !== undefined) {
        Object.assign(patch, timesPatch(row, changes, changes.allDay ?? row.allDay))
      }
      if (changes.recurrence !== undefined) {
        patch.rrule = changes.recurrence
          ? buildRRuleString(changes.recurrence, changes.tz ?? row.tz)
          : null
        patch.exdates = null
        // overrides belonged to the old pattern
        tx.update(events)
          .set({ deletedAt: now() })
          .where(and(eq(events.recurringEventId, row.id), isNull(events.deletedAt)))
          .run()
      }
      tx.update(events).set(patch).where(eq(events.id, row.id)).run()
      if (changes.personIds !== undefined) setPeople(tx, row.id, changes.personIds)
    })
  }

  /** scope 'this': create or update an exception row for one occurrence. */
  function upsertException(master: EventRow, occurrenceStartIso: string, changes: EventPatch): void {
    const occStart = norm(occurrenceStartIso)
    db.transaction((tx) => {
      const [existing] = tx
        .select()
        .from(events)
        .where(
          and(
            eq(events.recurringEventId, master.id),
            eq(events.originalStartAt, occStart),
            isNull(events.deletedAt)
          )
        )
        .all()
      if (existing) {
        applyDirect(tx, existing, changes)
        return
      }
      const base = occurrenceTimes(asMasterLike(master), occStart)
      const times = timesPatch(
        { startAt: base.start, endAt: base.end },
        changes,
        changes.allDay ?? master.allDay
      )
      const id = uuidv7()
      const ts = now()
      tx.insert(events)
        .values({
          id,
          calendarId: master.calendarId,
          title: changes.title ?? master.title,
          description: changes.description !== undefined ? changes.description : master.description,
          location: changes.location !== undefined ? changes.location : master.location,
          startAt: times.startAt ?? base.start,
          endAt: times.endAt ?? base.end,
          tz: changes.tz ?? master.tz,
          allDay: changes.allDay ?? master.allDay,
          rrule: null,
          recurringEventId: master.id,
          originalStartAt: occStart,
          status: 'confirmed',
          dirty: true,
          createdAt: ts,
          updatedAt: ts
        })
        .run()
      const masterPeople = peopleFor([master.id]).get(master.id) ?? []
      setPeople(tx, id, changes.personIds ?? masterPeople)
    })
  }

  /** scope 'following': cap the old series before the occurrence and start a new series there. */
  function splitSeries(master: EventRow, occurrenceStartIso: string, changes: EventPatch): void {
    const occStart = norm(occurrenceStartIso)
    if (occStart === master.startAt) {
      applyToMaster(master, changes, occurrenceStartIso)
      return
    }
    db.transaction((tx) => {
      const ts = now()
      // 1. Cap the old series
      const oldExdates = (parseArr(master.exdates) ?? []).filter((d) => d < occStart)
      tx.update(events)
        .set({
          rrule: withUntilInstant(master.rrule!, occStart),
          exdates: oldExdates.length > 0 ? JSON.stringify(oldExdates) : null,
          updatedAt: ts,
          dirty: true
        })
        .where(eq(events.id, master.id))
        .run()
      // 2. Overrides at/after the split belong to the replaced tail
      const exceptions = tx
        .select()
        .from(events)
        .where(and(eq(events.recurringEventId, master.id), isNull(events.deletedAt)))
        .all()
      for (const ex of exceptions) {
        if (ex.originalStartAt! >= occStart) {
          tx.update(events).set({ deletedAt: ts }).where(eq(events.id, ex.id)).run()
        }
      }
      // 3. New series from the split point
      const base = occurrenceTimes(asMasterLike(master), occStart)
      const times = timesPatch(
        { startAt: base.start, endAt: base.end },
        changes,
        changes.allDay ?? master.allDay
      )
      const tz = changes.tz ?? master.tz
      const rrule =
        changes.recurrence === null
          ? null
          : changes.recurrence !== undefined
            ? buildRRuleString(changes.recurrence, tz)
            : withoutEndCap(master.rrule!)
      const id = uuidv7()
      tx.insert(events)
        .values({
          id,
          calendarId: master.calendarId,
          title: changes.title ?? master.title,
          description: changes.description !== undefined ? changes.description : master.description,
          location: changes.location !== undefined ? changes.location : master.location,
          startAt: times.startAt ?? base.start,
          endAt: times.endAt ?? base.end,
          tz,
          allDay: changes.allDay ?? master.allDay,
          rrule,
          status: 'confirmed',
          dirty: true,
          createdAt: ts,
          updatedAt: ts
        })
        .run()
      const masterPeople = peopleFor([master.id]).get(master.id) ?? []
      setPeople(tx, id, changes.personIds ?? masterPeople)
    })
  }

  function update(input: EventUpdateInput): void {
    const row = getRow(input.id)
    assertWritable(row)

    if (row.recurringEventId) {
      // An exception instance — edits always apply to just that occurrence
      db.transaction((tx) => applyDirect(tx, row, input.changes))
      return
    }
    const isRecurring = row.rrule !== null
    if (!isRecurring || input.scope === 'all') {
      applyToMaster(row, input.changes, input.occurrenceStart)
      return
    }
    if (!input.occurrenceStart) throw invalid('occurrenceStart is required for this/following edits')
    if (input.scope === 'this') upsertException(row, input.occurrenceStart, input.changes)
    else splitSeries(row, input.occurrenceStart, input.changes)
  }

  function remove(input: EventDeleteInput): void {
    const row = getRow(input.id)
    assertWritable(row)
    const ts = now()

    if (row.recurringEventId) {
      // Deleting an exception instance removes that occurrence entirely
      db.transaction((tx) => {
        tx.update(events).set({ deletedAt: ts, dirty: true, updatedAt: ts }).where(eq(events.id, row.id)).run()
        const [master] = tx
          .select()
          .from(events)
          .where(and(eq(events.id, row.recurringEventId!), isNull(events.deletedAt)))
          .all()
        if (master) {
          const exdates = parseArr(master.exdates) ?? []
          if (!exdates.includes(row.originalStartAt!)) exdates.push(row.originalStartAt!)
          tx.update(events)
            .set({ exdates: JSON.stringify(exdates), updatedAt: ts, dirty: true })
            .where(eq(events.id, master.id))
            .run()
        }
      })
      return
    }

    if (row.rrule === null || input.scope === 'all') {
      db.transaction((tx) => {
        tx.update(events).set({ deletedAt: ts, dirty: true, updatedAt: ts }).where(eq(events.id, row.id)).run()
        tx.update(events)
          .set({ deletedAt: ts })
          .where(and(eq(events.recurringEventId, row.id), isNull(events.deletedAt)))
          .run()
      })
      return
    }

    if (!input.occurrenceStart) throw invalid('occurrenceStart is required for this/following deletes')
    const occStart = norm(input.occurrenceStart)

    if (input.scope === 'this') {
      db.transaction((tx) => {
        const exdates = parseArr(row.exdates) ?? []
        if (!exdates.includes(occStart)) exdates.push(occStart)
        tx.update(events)
          .set({ exdates: JSON.stringify(exdates), updatedAt: ts, dirty: true })
          .where(eq(events.id, row.id))
          .run()
        tx.update(events)
          .set({ deletedAt: ts })
          .where(
            and(
              eq(events.recurringEventId, row.id),
              eq(events.originalStartAt, occStart),
              isNull(events.deletedAt)
            )
          )
          .run()
      })
      return
    }

    // scope 'following'
    if (occStart === row.startAt) {
      remove({ id: input.id, scope: 'all' })
      return
    }
    db.transaction((tx) => {
      const exdates = (parseArr(row.exdates) ?? []).filter((d) => d < occStart)
      tx.update(events)
        .set({
          rrule: withUntilInstant(row.rrule!, occStart),
          exdates: exdates.length > 0 ? JSON.stringify(exdates) : null,
          updatedAt: ts,
          dirty: true
        })
        .where(eq(events.id, row.id))
        .run()
      const exceptions = tx
        .select()
        .from(events)
        .where(and(eq(events.recurringEventId, row.id), isNull(events.deletedAt)))
        .all()
      for (const ex of exceptions) {
        if (ex.originalStartAt! >= occStart) {
          tx.update(events).set({ deletedAt: ts }).where(eq(events.id, ex.id)).run()
        }
      }
    })
  }

  return { getOccurrences, getEvent, create, update, remove }
}

export type EventService = ReturnType<typeof createEventService>
