import { and, asc, desc, eq, inArray, isNull, lt } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { AppDb } from '../db/client'
import { checklistUnlocks, choreChecklists, choreCompletions, chores, people, starLedger } from '../db/schema'
import { uuidv7 } from '@shared/uuid'
import { isoUtc } from '@shared/dates'
import { buildRRuleString, parseRRuleString } from '@shared/recurrence/build'
import { expandOccurrences } from '@shared/recurrence/expand'
import type {
  ChecklistDto,
  ChecklistInput,
  ChoreCreateInput,
  ChoreDto,
  ChoreUpdateInput,
  DayChecklistDto,
  DayChoreDto,
  PendingUnlockDto,
  StarBalanceDto,
  UnlockState
} from '@shared/types'
import { invalid, notFound } from './errors'

type ChoreRow = typeof chores.$inferSelect
type ChecklistRow = typeof choreChecklists.$inferSelect

/** The scheduling fields chores and checklists share. */
interface Schedule {
  id: string
  scheduleRrule: string | null
  dueDate: string | null
  createdAt: string
}

function parseIds(json: string | null): string[] {
  if (!json) return []
  try {
    const ids: unknown = JSON.parse(json)
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function createChoresService(db: AppDb, deviceTz: () => string) {
  function anchorOf(row: Schedule): string {
    return row.dueDate ?? DateTime.fromISO(row.createdAt).setZone(deviceTz()).toISODate()!
  }

  /** Times a chore can be done on a day it's due; null = no limit (stored as 0). */
  function timesOf(row: ChoreRow): number | null {
    return row.times === 0 ? null : row.times
  }

  function toDto(row: ChoreRow): ChoreDto {
    return {
      id: row.id,
      title: row.title,
      icon: row.icon,
      starsValue: row.starsValue,
      recurrence: row.scheduleRrule ? parseRRuleString(row.scheduleRrule, deviceTz()) : null,
      anchorDate: anchorOf(row),
      routine: row.routine,
      active: row.active,
      sortOrder: row.sortOrder,
      mode: row.mode,
      assignees: row.mode === 'each' ? parseIds(row.assignees) : [],
      times: timesOf(row)
    }
  }

  /** Family members who haven't been removed. */
  function livePeople(): Set<string> {
    return new Set(
      db
        .select({ id: people.id })
        .from(people)
        .where(isNull(people.deletedAt))
        .all()
        .map((p) => p.id)
    )
  }

  function list(): ChoreDto[] {
    // checklist items are listed with their checklist, not as chores of their own
    return db
      .select()
      .from(chores)
      .where(and(isNull(chores.deletedAt), isNull(chores.checklistId)))
      .orderBy(asc(chores.sortOrder), asc(chores.createdAt))
      .all()
      .map(toDto)
  }

  function create(input: ChoreCreateInput): ChoreDto {
    const zone = deviceTz()
    const anchor = input.anchorDate ?? DateTime.now().setZone(zone).toISODate()!
    const mode = input.mode ?? 'anyone'
    if (mode === 'each' && !input.assignees?.length) throw invalid('Pick who has to do this chore')
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
        createdAt: isoUtc(DateTime.utc()),
        mode,
        assignees: mode === 'each' ? JSON.stringify(input.assignees) : null,
        times: input.times === undefined ? 1 : (input.times ?? 0)
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
    if (input.mode !== undefined) patch.mode = input.mode
    if (input.assignees !== undefined) patch.assignees = JSON.stringify(input.assignees)
    if (input.times !== undefined) patch.times = input.times ?? 0
    if (input.mode === 'each' && !input.assignees?.length) throw invalid('Pick who has to do this chore')
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

  /** Is this chore (or checklist) due on the given local calendar date? */
  function isDueOn(row: Schedule, date: string): boolean {
    const zone = deviceTz()
    const anchor = anchorOf(row)
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

  /** Who did what on a date: chore id → person ids, in completion order. */
  function completionsOn(date: string): Map<string, string[]> {
    const byChore = new Map<string, string[]>()
    const rows = db
      .select()
      .from(choreCompletions)
      .where(eq(choreCompletions.dueDate, date))
      .orderBy(asc(choreCompletions.completedAt), asc(choreCompletions.id))
      .all()
    for (const c of rows) byChore.set(c.choreId, [...(byChore.get(c.choreId) ?? []), c.personId])
    return byChore
  }

  /**
   * A chore as shown for a day; `assignees` overrides the chore's own (checklist items).
   * `done` = who did it each time that day, oldest first. It counts as done once it's been
   * done `times` times (per person for 'each'), or once at all when there's no limit.
   */
  function dayChore(row: ChoreRow, done: string[], live: Set<string>, assignees?: string[]): DayChoreDto {
    const times = assignees ? 1 : timesOf(row)
    const needed = times ?? 1
    if (row.mode === 'anyone' && !assignees) {
      return {
        choreId: row.id,
        title: row.title,
        icon: row.icon,
        starsValue: row.starsValue,
        routine: row.routine,
        completed: done.length >= needed,
        completedBy: done[0] ?? null,
        mode: 'anyone',
        assignees: [],
        doneBy: [],
        times,
        claims: done
      }
    }
    const who = (assignees ?? parseIds(row.assignees)).filter((p) => live.has(p))
    const doneBy = who.filter((p) => done.filter((d) => d === p).length >= needed)
    return {
      choreId: row.id,
      title: row.title,
      icon: row.icon,
      starsValue: row.starsValue,
      routine: row.routine,
      completed: who.length > 0 && doneBy.length === who.length,
      completedBy: null,
      mode: 'each',
      assignees: who,
      doneBy,
      times,
      claims: done.filter((d) => who.includes(d))
    }
  }

  function getDay(date: string): DayChoreDto[] {
    const rows = db
      .select()
      .from(chores)
      .where(and(isNull(chores.deletedAt), eq(chores.active, true), isNull(chores.checklistId)))
      .orderBy(asc(chores.sortOrder), asc(chores.createdAt))
      .all()
    const done = completionsOn(date)
    const live = livePeople()
    const routineOrder = { morning: 0, null: 1, evening: 2 } as Record<string, number>
    // person_id is legacy and ignored: 'anyone' chores belong to no one
    return rows
      .filter((row) => isDueOn(row, date))
      .map((row) => dayChore(row, done.get(row.id) ?? [], live))
      .filter((c) => c.mode === 'anyone' || c.assignees.length > 0)
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

  function checklistRow(id: string): ChecklistRow | undefined {
    const [row] = db
      .select()
      .from(choreChecklists)
      .where(and(eq(choreChecklists.id, id), isNull(choreChecklists.deletedAt)))
      .all()
    return row
  }

  function checklistItems(checklistId: string): ChoreRow[] {
    return db
      .select()
      .from(chores)
      .where(and(eq(chores.checklistId, checklistId), isNull(chores.deletedAt)))
      .orderBy(asc(chores.sortOrder), asc(chores.createdAt))
      .all()
  }

  /** Who has to do this chore on its own terms (a checklist item answers to its checklist). */
  function assigneesOf(chore: ChoreRow): string[] | null {
    if (chore.checklistId) {
      const checklist = checklistRow(chore.checklistId)
      return checklist ? parseIds(checklist.assignees) : []
    }
    return chore.mode === 'each' ? parseIds(chore.assignees) : null
  }

  /**
   * personId did the chore. 'anyone': they claim it (a later claim doesn't steal it).
   * 'each': their own tick. Finishing a checklist's last item marks it unlocked for them,
   * waiting for a parent to sign off.
   */
  function complete(choreId: string, date: string, personId: string): { balance: number; unlocked?: string } {
    const [chore] = db.select().from(chores).where(and(eq(chores.id, choreId), isNull(chores.deletedAt))).all()
    if (!chore) throw notFound('Chore')
    const [person] = db.select().from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).all()
    if (!person) throw notFound('Person')
    const assignees = assigneesOf(chore)
    if (assignees && !assignees.includes(personId)) throw invalid(`${person.name} isn't on this chore`)

    const existing = db
      .select()
      .from(choreCompletions)
      .where(and(eq(choreCompletions.choreId, choreId), eq(choreCompletions.dueDate, date)))
      .all()
    // full up for the day (checklist items: once each) — nothing more to add
    const limit = chore.checklistId ? 1 : (timesOf(chore) ?? Infinity)
    const mine = existing.filter((c) => c.personId === personId).length
    // 'anyone': the claims stand, and the balance shown is the first claimant's
    if (!assignees && existing.length >= limit) return { balance: balanceOf(existing[0].personId) }
    if (assignees && mine >= limit) return { balance: balanceOf(personId) }

    const completionId = uuidv7()
    const now = isoUtc(DateTime.utc())
    let unlocked: string | undefined
    db.transaction((tx) => {
      tx.insert(choreCompletions)
        .values({ id: completionId, choreId, personId, dueDate: date, completedAt: now, starsAwarded: chore.starsValue })
        .run()
      if (chore.starsValue > 0) {
        tx.insert(starLedger)
          .values({ id: uuidv7(), personId, delta: chore.starsValue, reason: 'chore', refId: completionId, createdAt: now })
          .run()
      }
      if (chore.checklistId) {
        const checklist = checklistRow(chore.checklistId)
        const items = checklistItems(chore.checklistId).map((i) => i.id)
        const doneItems = new Set(
          tx
            .select()
            .from(choreCompletions)
            .where(
              and(
                inArray(choreCompletions.choreId, items),
                eq(choreCompletions.dueDate, date),
                eq(choreCompletions.personId, personId)
              )
            )
            .all()
            .map((c) => c.choreId)
        )
        if (checklist && items.every((i) => doneItems.has(i))) {
          tx.insert(checklistUnlocks)
            .values({ id: uuidv7(), checklistId: checklist.id, personId, dueDate: date, status: 'pending', unlockedAt: now })
            .onConflictDoNothing()
            .run()
          unlocked = checklist.title
        }
      }
    })
    return { balance: balanceOf(personId), unlocked }
  }

  /**
   * Un-ticks the chore and takes its stars back. 'anyone': from whoever claimed it.
   * 'each': personId's tick (required) — and their checklist unlock, which no longer holds.
   */
  /** Takes back the newest tick (that person's, for 'each'), with its stars. */
  function uncomplete(choreId: string, date: string, personId?: string): { balance: number } {
    const [chore] = db.select().from(chores).where(eq(chores.id, choreId)).all()
    if (!chore) throw notFound('Chore')
    const perPerson = assigneesOf(chore) !== null
    if (perPerson && !personId) throw invalid('Whose tick should be removed?')
    const [completion] = db
      .select()
      .from(choreCompletions)
      .where(
        and(
          eq(choreCompletions.choreId, choreId),
          eq(choreCompletions.dueDate, date),
          ...(perPerson ? [eq(choreCompletions.personId, personId!)] : [])
        )
      )
      // the newest tick goes first (a chore done more than once a day loses one at a time)
      .orderBy(desc(choreCompletions.completedAt), desc(choreCompletions.id))
      .limit(1)
      .all()
    if (!completion) return { balance: personId ? balanceOf(personId) : 0 }
    db.transaction((tx) => {
      tx.delete(starLedger).where(eq(starLedger.refId, completion.id)).run()
      tx.delete(choreCompletions).where(eq(choreCompletions.id, completion.id)).run()
      if (chore.checklistId) {
        tx.delete(checklistUnlocks)
          .where(
            and(
              eq(checklistUnlocks.checklistId, chore.checklistId),
              eq(checklistUnlocks.personId, completion.personId),
              eq(checklistUnlocks.dueDate, date)
            )
          )
          .run()
      }
    })
    return { balance: balanceOf(completion.personId) }
  }

  // ── checklists ────────────────────────────────────────────────────────────

  function checklistToDto(row: ChecklistRow): ChecklistDto {
    return {
      id: row.id,
      title: row.title,
      assignees: parseIds(row.assignees),
      recurrence: row.scheduleRrule ? parseRRuleString(row.scheduleRrule, deviceTz()) : null,
      anchorDate: anchorOf(row),
      items: checklistItems(row.id).map((i) => ({ id: i.id, title: i.title }))
    }
  }

  function checklists(): ChecklistDto[] {
    return db
      .select()
      .from(choreChecklists)
      .where(isNull(choreChecklists.deletedAt))
      .orderBy(asc(choreChecklists.sortOrder), asc(choreChecklists.createdAt))
      .all()
      .map(checklistToDto)
  }

  /** Brings the checklist's items in line with `items` (rename kept ids, add new, remove missing). */
  function syncItems(checklistId: string, items: ChecklistInput['items']): void {
    const now = isoUtc(DateTime.utc())
    const current = checklistItems(checklistId)
    const keep = new Set(items.map((i) => i.id).filter(Boolean))
    for (const row of current) {
      if (!keep.has(row.id)) db.update(chores).set({ deletedAt: now }).where(eq(chores.id, row.id)).run()
    }
    items.forEach((item, sortOrder) => {
      if (item.id && current.some((r) => r.id === item.id)) {
        db.update(chores).set({ title: item.title, sortOrder }).where(eq(chores.id, item.id)).run()
      } else {
        // items earn no stars of their own: the checklist's prize is the reward
        db.insert(chores)
          .values({ id: uuidv7(), title: item.title, starsValue: 0, mode: 'each', checklistId, sortOrder, active: true, createdAt: now })
          .run()
      }
    })
  }

  function createChecklist(input: ChecklistInput): ChecklistDto {
    const zone = deviceTz()
    const id = uuidv7()
    db.transaction(() => {
      db.insert(choreChecklists)
        .values({
          id,
          title: input.title,
          assignees: JSON.stringify(input.assignees),
          scheduleRrule: input.recurrence ? buildRRuleString(input.recurrence, zone) : null,
          dueDate: input.anchorDate ?? DateTime.now().setZone(zone).toISODate()!,
          createdAt: isoUtc(DateTime.utc())
        })
        .run()
      syncItems(id, input.items)
    })
    return checklistToDto(checklistRow(id)!)
  }

  function updateChecklist(input: ChecklistInput & { id: string }): ChecklistDto {
    if (!checklistRow(input.id)) throw notFound('Checklist')
    const zone = deviceTz()
    db.transaction(() => {
      db.update(choreChecklists)
        .set({
          title: input.title,
          assignees: JSON.stringify(input.assignees),
          scheduleRrule: input.recurrence ? buildRRuleString(input.recurrence, zone) : null,
          ...(input.anchorDate ? { dueDate: input.anchorDate } : {})
        })
        .where(eq(choreChecklists.id, input.id))
        .run()
      syncItems(input.id, input.items)
    })
    return checklistToDto(checklistRow(input.id)!)
  }

  function removeChecklist(id: string): void {
    if (!checklistRow(id)) throw notFound('Checklist')
    const now = isoUtc(DateTime.utc())
    db.transaction(() => {
      db.update(choreChecklists).set({ deletedAt: now }).where(eq(choreChecklists.id, id)).run()
      db.update(chores).set({ deletedAt: now }).where(and(eq(chores.checklistId, id), isNull(chores.deletedAt))).run()
    })
  }

  function checklistsDay(date: string): DayChecklistDto[] {
    const done = completionsOn(date)
    const live = livePeople()
    const unlocks = db.select().from(checklistUnlocks).where(eq(checklistUnlocks.dueDate, date)).all()
    return db
      .select()
      .from(choreChecklists)
      .where(isNull(choreChecklists.deletedAt))
      .orderBy(asc(choreChecklists.sortOrder), asc(choreChecklists.createdAt))
      .all()
      .filter((row) => isDueOn(row, date))
      .map((row) => {
        const who = parseIds(row.assignees).filter((p) => live.has(p))
        const items = checklistItems(row.id).map((i) => dayChore(i, done.get(i.id) ?? [], live, who))
        return {
          checklistId: row.id,
          title: row.title,
          items,
          people: who.map((personId) => {
            const unlock = unlocks.find((u) => u.checklistId === row.id && u.personId === personId)
            const state: UnlockState = unlock ? unlock.status : 'locked'
            return { personId, done: items.filter((i) => i.doneBy.includes(personId)).length, total: items.length, unlock: state }
          })
        }
      })
      .filter((c) => c.items.length > 0 && c.people.length > 0)
  }

  function pendingUnlocks(date: string): PendingUnlockDto[] {
    return db
      .select({
        checklistId: checklistUnlocks.checklistId,
        title: choreChecklists.title,
        personId: checklistUnlocks.personId,
        date: checklistUnlocks.dueDate
      })
      .from(checklistUnlocks)
      .innerJoin(choreChecklists, eq(choreChecklists.id, checklistUnlocks.checklistId))
      .where(
        and(eq(checklistUnlocks.status, 'pending'), eq(checklistUnlocks.dueDate, date), isNull(choreChecklists.deletedAt))
      )
      .orderBy(asc(checklistUnlocks.unlockedAt))
      .all()
  }

  /** A parent signs off: the prize is unlocked for that person today. */
  function approveUnlock(checklistId: string, personId: string, date: string): void {
    const result = db
      .update(checklistUnlocks)
      .set({ status: 'approved', approvedAt: isoUtc(DateTime.utc()) })
      .where(
        and(
          eq(checklistUnlocks.checklistId, checklistId),
          eq(checklistUnlocks.personId, personId),
          eq(checklistUnlocks.dueDate, date),
          eq(checklistUnlocks.status, 'pending')
        )
      )
      .run()
    if (result.changes === 0) throw notFound('Unlock')
  }

  /**
   * Drop completions due before `date` (the chore history only goes back a few days).
   * Stars live in the ledger, so balances are untouched. Returns how many rows went.
   */
  function purgeCompletionsBefore(date: string): number {
    return db.delete(choreCompletions).where(lt(choreCompletions.dueDate, date)).run().changes
  }

  return {
    list,
    create,
    update,
    remove,
    getDay,
    complete,
    uncomplete,
    balances,
    balanceOf,
    checklists,
    createChecklist,
    updateChecklist,
    removeChecklist,
    checklistsDay,
    pendingUnlocks,
    approveUnlock,
    purgeCompletionsBefore
  }
}

export type ChoresService = ReturnType<typeof createChoresService>
