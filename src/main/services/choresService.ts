import { and, asc, eq, isNull } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { AppDb } from '../db/client'
import { choreCompletions, chores, people, starLedger } from '../db/schema'
import { uuidv7 } from '@shared/uuid'
import { isoUtc } from '@shared/dates'
import { buildRRuleString, parseRRuleString } from '@shared/recurrence/build'
import { expandOccurrences } from '@shared/recurrence/expand'
import type { ChoreCreateInput, ChoreDto, ChoreUpdateInput, DayChoreDto, StarBalanceDto } from '@shared/types'
import { notFound } from './errors'

type ChoreRow = typeof chores.$inferSelect

export function createChoresService(db: AppDb, deviceTz: () => string) {
  function toDto(row: ChoreRow): ChoreDto {
    const zone = deviceTz()
    return {
      id: row.id,
      title: row.title,
      icon: row.icon,
      starsValue: row.starsValue,
      recurrence: row.scheduleRrule ? parseRRuleString(row.scheduleRrule, zone) : null,
      anchorDate: row.dueDate ?? DateTime.fromISO(row.createdAt).setZone(zone).toISODate()!,
      routine: row.routine,
      active: row.active,
      sortOrder: row.sortOrder
    }
  }

  function list(): ChoreDto[] {
    return db
      .select()
      .from(chores)
      .where(isNull(chores.deletedAt))
      .orderBy(asc(chores.sortOrder), asc(chores.createdAt))
      .all()
      .map(toDto)
  }

  function create(input: ChoreCreateInput): ChoreDto {
    const zone = deviceTz()
    const anchor = input.anchorDate ?? DateTime.now().setZone(zone).toISODate()!
    const id = uuidv7()
    db.insert(chores)
      .values({
        id,
        title: input.title,
        starsValue: input.starsValue,
        scheduleRrule: input.recurrence ? buildRRuleString(input.recurrence, zone) : null,
        dueDate: anchor,
        routine: input.routine ?? null,
        active: true,
        createdAt: isoUtc(DateTime.utc())
      })
      .run()
    const [row] = db.select().from(chores).where(eq(chores.id, id)).all()
    return toDto(row)
  }

  function update(input: ChoreUpdateInput): ChoreDto {
    const zone = deviceTz()
    const patch: Partial<typeof chores.$inferInsert> = {}
    if (input.title !== undefined) patch.title = input.title
    if (input.starsValue !== undefined) patch.starsValue = input.starsValue
    if (input.recurrence !== undefined) {
      patch.scheduleRrule = input.recurrence ? buildRRuleString(input.recurrence, zone) : null
    }
    if (input.anchorDate !== undefined) patch.dueDate = input.anchorDate
    if (input.routine !== undefined) patch.routine = input.routine
    if (input.active !== undefined) patch.active = input.active
    const result = db
      .update(chores)
      .set(patch)
      .where(and(eq(chores.id, input.id), isNull(chores.deletedAt)))
      .run()
    if (result.changes === 0) throw notFound('Chore')
    const [row] = db.select().from(chores).where(eq(chores.id, input.id)).all()
    return toDto(row)
  }

  function remove(id: string): void {
    const result = db
      .update(chores)
      .set({ deletedAt: isoUtc(DateTime.utc()) })
      .where(and(eq(chores.id, id), isNull(chores.deletedAt)))
      .run()
    if (result.changes === 0) throw notFound('Chore')
  }

  /** Is this chore due on the given local calendar date? */
  function isDueOn(row: ChoreRow, date: string): boolean {
    const zone = deviceTz()
    const anchor = row.dueDate ?? DateTime.fromISO(row.createdAt).setZone(zone).toISODate()!
    if (!row.scheduleRrule) return anchor === date
    if (date < anchor) return false
    const dayStart = DateTime.fromISO(date, { zone }).startOf('day')
    const occurrences = expandOccurrences(
      {
        id: row.id,
        startAt: isoUtc(DateTime.fromISO(anchor, { zone }).startOf('day')),
        endAt: isoUtc(DateTime.fromISO(anchor, { zone }).startOf('day').plus({ days: 1 })),
        tz: zone,
        allDay: true,
        rrule: row.scheduleRrule,
        rdates: null,
        exdates: null
      },
      [],
      isoUtc(dayStart),
      isoUtc(dayStart.plus({ days: 1 }))
    )
    return occurrences.some((o) => DateTime.fromISO(o.start, { zone: 'utc' }).setZone(zone).toISODate() === date)
  }

  function getDay(date: string): DayChoreDto[] {
    const rows = db
      .select()
      .from(chores)
      .where(and(isNull(chores.deletedAt), eq(chores.active, true)))
      .orderBy(asc(chores.sortOrder), asc(chores.createdAt))
      .all()
    const claimedBy = new Map(
      db
        .select()
        .from(choreCompletions)
        .where(eq(choreCompletions.dueDate, date))
        .all()
        .map((c) => [c.choreId, c.personId])
    )
    const routineOrder = { morning: 0, null: 1, evening: 2 } as Record<string, number>
    // chores belong to no one (person_id is legacy and ignored); every due chore is listed once
    return rows
      .filter((row) => isDueOn(row, date))
      .map((row) => ({
        choreId: row.id,
        title: row.title,
        icon: row.icon,
        starsValue: row.starsValue,
        routine: row.routine,
        completed: claimedBy.has(row.id),
        completedBy: claimedBy.get(row.id) ?? null
      }))
      .sort((a, b) => routineOrder[String(a.routine)] - routineOrder[String(b.routine)])
  }

  function balanceOf(personId: string): number {
    const rows = db.select().from(starLedger).where(eq(starLedger.personId, personId)).all()
    return rows.reduce((acc, r) => acc + r.delta, 0)
  }

  function balances(): StarBalanceDto[] {
    const totals = new Map<string, number>()
    for (const row of db.select().from(starLedger).all()) {
      totals.set(row.personId, (totals.get(row.personId) ?? 0) + row.delta)
    }
    return [...totals.entries()].map(([personId, balance]) => ({ personId, balance }))
  }

  /** personId claims the chore: the completion and its stars go to them. */
  function complete(choreId: string, date: string, personId: string): { balance: number } {
    const [chore] = db.select().from(chores).where(and(eq(chores.id, choreId), isNull(chores.deletedAt))).all()
    if (!chore) throw notFound('Chore')
    const [person] = db.select().from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).all()
    if (!person) throw notFound('Person')
    const [existing] = db
      .select()
      .from(choreCompletions)
      .where(and(eq(choreCompletions.choreId, choreId), eq(choreCompletions.dueDate, date)))
      .all()
    if (!existing) {
      const completionId = uuidv7()
      const now = isoUtc(DateTime.utc())
      db.transaction((tx) => {
        tx.insert(choreCompletions)
          .values({
            id: completionId,
            choreId,
            personId,
            dueDate: date,
            completedAt: now,
            starsAwarded: chore.starsValue
          })
          .run()
        if (chore.starsValue > 0) {
          tx.insert(starLedger)
            .values({
              id: uuidv7(),
              personId,
              delta: chore.starsValue,
              reason: 'chore',
              refId: completionId,
              createdAt: now
            })
            .run()
        }
      })
    }
    // already done today: someone else's claim stands, and the balance shown is the claimant's
    return { balance: balanceOf(existing?.personId ?? personId) }
  }

  /** Un-ticks the chore: the claim and its stars are taken back from whoever made it. */
  function uncomplete(choreId: string, date: string): { balance: number } {
    const [chore] = db.select().from(chores).where(eq(chores.id, choreId)).all()
    if (!chore) throw notFound('Chore')
    const [completion] = db
      .select()
      .from(choreCompletions)
      .where(and(eq(choreCompletions.choreId, choreId), eq(choreCompletions.dueDate, date)))
      .all()
    if (completion) {
      db.transaction((tx) => {
        tx.delete(starLedger).where(eq(starLedger.refId, completion.id)).run()
        tx.delete(choreCompletions).where(eq(choreCompletions.id, completion.id)).run()
      })
    }
    return { balance: completion ? balanceOf(completion.personId) : 0 }
  }

  return { list, create, update, remove, getDay, complete, uncomplete, balances, balanceOf }
}

export type ChoresService = ReturnType<typeof createChoresService>
