import { and, asc, desc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { AppDb } from '../db/client'
import { checklistUnlocks, choreChecklists, choreCompletions, chores, people, settings, starLedger, videoGameRounds } from '../db/schema'
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
import { VIDEO_GAMES_SET_ID } from '@shared/types'
import { invalid, notFound } from './errors'

type ChoreRow = typeof chores.$inferSelect
type ChecklistRow = typeof choreChecklists.$inferSelect
/** Any write handle: the database or a transaction on it. */
type DbOrTx = Pick<AppDb, 'select' | 'insert' | 'update' | 'delete'>

/** Settings key for the Video Games set reward (controllers per finished round). */
const KEY_VIDEO_GAMES_STARS = 'chores.videoGamesStars'
const DEFAULT_VIDEO_GAMES_STARS = 60

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
      assignees: row.mode !== 'anyone' ? parseIds(row.assignees) : [],
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
    if (mode !== 'anyone' && !input.assignees?.length) throw invalid('Pick who has to do this chore')
    const id = uuidv7()
    db.insert(chores)
      .values({
        id,
        title: input.title,
        // Video Games tasks pay nothing alone: the set's reward is paid per finished round
        starsValue: mode === 'videogames' ? 0 : input.starsValue,
        scheduleRrule: input.recurrence ? buildRRuleString(input.recurrence, zone) : null,
        dueDate: anchor,
        routine: input.routine ?? null,
        active: true,
        createdAt: isoUtc(DateTime.utc()),
        mode,
        assignees: mode !== 'anyone' ? JSON.stringify(input.assignees) : null,
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
    if (input.mode === 'videogames') patch.starsValue = 0
    if (input.assignees !== undefined) patch.assignees = JSON.stringify(input.assignees)
    if (input.times !== undefined) patch.times = input.times ?? 0
    if ((input.mode === 'each' || input.mode === 'videogames') && !input.assignees?.length) {
      throw invalid('Pick who has to do this chore')
    }
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
      .orderBy(asc(choreCompletions.completedAt), asc(sql`rowid`))
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
      mode: row.mode === 'videogames' ? 'videogames' : 'each',
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
      // Video Games tasks show in their set's card (checklistsDay), not as chores of their own
      .filter((row) => row.mode !== 'videogames' && isDueOn(row, date))
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
    return chore.mode !== 'anyone' ? parseIds(chore.assignees) : null
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
          .values({ id: uuidv7(), personId, delta: chore.starsValue, reason: 'chore', refId: completionId, createdAt: now, note: chore.title })
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
      if (chore.mode === 'videogames' && syncRounds(tx, personId, date)) unlocked = 'Video Games'
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
      // the newest tick goes first (a chore done more than once a day loses one at a time);
      // rowid breaks ties within a millisecond, which uuidv7 ids do not order
      .orderBy(desc(choreCompletions.completedAt), desc(sql`rowid`))
      .limit(1)
      .all()
    if (!completion) return { balance: personId ? balanceOf(personId) : 0 }
    db.transaction((tx) => {
      // the log keeps the gain and shows the take-back, rather than the gain vanishing
      reverse(tx, completion.id, completion.personId, `Un-ticked: ${chore.title}`)
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
      // a round that no longer holds is withdrawn (and its controllers taken back if paid)
      if (chore.mode === 'videogames') syncRounds(tx, completion.personId, date)
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
      .map((c): DayChecklistDto => ({ ...c, kind: 'checklist' }))
      .concat([videoGamesDay(date)].filter((v): v is DayChecklistDto => v !== null && v.people.length > 0))
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
      .map((u): PendingUnlockDto => ({ ...u, kind: 'checklist' }))
      .concat(
        db
          .select()
          .from(videoGameRounds)
          // Video Games sets wait until a parent approves them — they don't drop off at midnight
          .where(and(eq(videoGameRounds.status, 'pending'), lte(videoGameRounds.dueDate, date)))
          // oldest day first, so a set left over from yesterday is dealt with before today's
          .orderBy(asc(videoGameRounds.dueDate), asc(videoGameRounds.completedAt), asc(videoGameRounds.round))
          .all()
          .map((r) => ({
            checklistId: VIDEO_GAMES_SET_ID,
            title: 'Video Games',
            personId: r.personId,
            date: r.dueDate,
            kind: 'videogames' as const,
            round: r.round,
            stars: r.stars
          }))
      )
  }

  /** A parent signs off: the prize is unlocked for that person today. */
  function approveUnlock(checklistId: string, personId: string, date: string, round?: number): void {
    if (checklistId === VIDEO_GAMES_SET_ID) return approveVideoGames(personId, date, round ?? 1)
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
   * Takes back whatever was paid for `refId` with one minus line (so the log shows both the gain and
   * the take-back); nothing if nothing was paid or it was already taken back.
   */
  function reverse(tx: DbOrTx, refId: string, personId: string, note: string): void {
    const paid = tx
      .select()
      .from(starLedger)
      .where(eq(starLedger.refId, refId))
      .all()
      .reduce((acc, r) => acc + r.delta, 0)
    if (paid === 0) return
    tx.insert(starLedger)
      .values({ id: uuidv7(), personId, delta: -paid, reason: 'chore', refId, createdAt: isoUtc(DateTime.utc()), note })
      .run()
  }

  // ── Video Games ───────────────────────────────────────────────────────────

  function videoGamesStars(): number {
    const [row] = db.select().from(settings).where(eq(settings.key, KEY_VIDEO_GAMES_STARS)).all()
    const n = row ? Number(row.value) : NaN
    return Number.isInteger(n) && n >= 0 ? n : DEFAULT_VIDEO_GAMES_STARS
  }

  function setVideoGamesStars(stars: number): { stars: number } {
    db.insert(settings)
      .values({ key: KEY_VIDEO_GAMES_STARS, value: String(stars) })
      .onConflictDoUpdate({ target: settings.key, set: { value: String(stars) } })
      .run()
    return { stars }
  }

  /** The Video Games tasks due on `date` (all of them, or just personId's). */
  function videoGameTasks(date: string, personId?: string, from: DbOrTx = db): ChoreRow[] {
    return from
      .select()
      .from(chores)
      .where(and(isNull(chores.deletedAt), eq(chores.active, true), eq(chores.mode, 'videogames'), isNull(chores.checklistId)))
      .orderBy(asc(chores.sortOrder), asc(chores.createdAt))
      .all()
      .filter((row) => isDueOn(row, date) && (!personId || parseIds(row.assignees).includes(personId)))
  }

  /**
   * How far a person is through the day's set: `rounds` = whole sets done (the fewest times any
   * one task was done), `max` = how many rounds the tasks allow (each task's times; null = no limit).
   */
  function roundsOf(tasks: ChoreRow[], counts: (choreId: string) => number): { rounds: number; max: number | null } {
    if (tasks.length === 0) return { rounds: 0, max: 0 }
    const rounds = Math.min(...tasks.map((t) => counts(t.id)))
    const limits = tasks.map((t) => timesOf(t)).filter((t): t is number => t !== null)
    return { rounds, max: limits.length > 0 ? Math.min(...limits) : null }
  }

  /**
   * Brings personId's finished rounds for the day in line with their ticks: new rounds wait for a
   * parent (pending); rounds that no longer hold are removed, with their controllers if paid.
   * Returns whether a round was just finished.
   */
  function syncRounds(tx: DbOrTx, personId: string, date: string): boolean {
    const tasks = videoGameTasks(date, personId, tx)
    const ids = tasks.map((t) => t.id)
    const ticks = ids.length
      ? tx
          .select()
          .from(choreCompletions)
          .where(and(inArray(choreCompletions.choreId, ids), eq(choreCompletions.dueDate, date), eq(choreCompletions.personId, personId)))
          .all()
      : []
    const { rounds } = roundsOf(tasks, (id) => ticks.filter((c) => c.choreId === id).length)
    const existing = tx
      .select()
      .from(videoGameRounds)
      .where(and(eq(videoGameRounds.personId, personId), eq(videoGameRounds.dueDate, date)))
      .all()
    for (const r of existing.filter((r) => r.round > rounds)) {
      reverse(tx, r.id, personId, '🎮 Video Games set taken back (a task was un-ticked)')
      tx.delete(videoGameRounds).where(eq(videoGameRounds.id, r.id)).run()
    }
    let added = false
    const now = isoUtc(DateTime.utc())
    for (let round = 1; round <= rounds; round++) {
      if (existing.some((r) => r.round === round)) continue
      tx.insert(videoGameRounds)
        .values({ id: uuidv7(), personId, dueDate: date, round, stars: videoGamesStars(), status: 'pending', completedAt: now })
        .run()
      added = true
    }
    return added
  }

  /**
   * The day's Video Games set as a checklist-style card. A task counts as ticked for a person once
   * they've done it this round (after a finished round the ticks start over, if the tasks allow).
   */
  function videoGamesDay(date: string): DayChecklistDto | null {
    const tasks = videoGameTasks(date)
    if (tasks.length === 0) return null
    const live = livePeople()
    const done = completionsOn(date)
    const rows = db.select().from(videoGameRounds).where(eq(videoGameRounds.dueDate, date)).all()
    const everyone = [...new Set(tasks.flatMap((t) => parseIds(t.assignees)))].filter((p) => live.has(p))
    const progress = new Map(
      everyone.map((p) => {
        const mine = tasks.filter((t) => parseIds(t.assignees).includes(p))
        const count = (id: string): number => (done.get(id) ?? []).filter((d) => d === p).length
        const { rounds, max } = roundsOf(mine, count)
        const finished = max !== null && rounds >= max
        // ticked = done in the round under way; everything stays ticked once no more rounds fit
        const ticked = new Set(mine.filter((t) => (finished ? count(t.id) > 0 : count(t.id) > rounds)).map((t) => t.id))
        return [p, { mine, rounds, finished, ticked }] as const
      })
    )
    const items: DayChoreDto[] = tasks.map((t) => {
      const who = parseIds(t.assignees).filter((p) => live.has(p))
      const doneBy = who.filter((p) => progress.get(p)!.ticked.has(t.id))
      return {
        choreId: t.id,
        title: t.title,
        icon: t.icon,
        starsValue: 0,
        routine: t.routine,
        completed: who.length > 0 && doneBy.length === who.length,
        completedBy: null,
        mode: 'videogames',
        assignees: who,
        doneBy,
        times: timesOf(t),
        claims: (done.get(t.id) ?? []).filter((d) => who.includes(d))
      }
    })
    return {
      checklistId: VIDEO_GAMES_SET_ID,
      title: 'Video Games',
      kind: 'videogames',
      stars: videoGamesStars(),
      items,
      people: everyone.map((personId) => {
        const p = progress.get(personId)!
        const mineRounds = rows.filter((r) => r.personId === personId)
        const unlock: UnlockState = mineRounds.some((r) => r.status === 'pending')
          ? 'pending'
          : p.finished && p.rounds > 0
            ? 'approved'
            : 'locked'
        return {
          personId,
          done: p.ticked.size,
          total: p.mine.length,
          unlock,
          rounds: mineRounds.filter((r) => r.status === 'approved').length
        }
      })
    }
  }

  /** A parent signs off a finished round: the set's controllers go to that person. */
  function approveVideoGames(personId: string, date: string, round: number): void {
    const [row] = db
      .select()
      .from(videoGameRounds)
      .where(
        and(
          eq(videoGameRounds.personId, personId),
          eq(videoGameRounds.dueDate, date),
          eq(videoGameRounds.round, round),
          eq(videoGameRounds.status, 'pending')
        )
      )
      .all()
    if (!row) throw notFound('Video Games round')
    const now = isoUtc(DateTime.utc())
    db.transaction((tx) => {
      tx.update(videoGameRounds).set({ status: 'approved', approvedAt: now }).where(eq(videoGameRounds.id, row.id)).run()
      if (row.stars > 0) {
        tx.insert(starLedger)
          .values({
            id: uuidv7(),
            personId,
            delta: row.stars,
            reason: 'chore',
            refId: row.id,
            createdAt: now,
            note: `🎮 Video Games set${round > 1 ? ` (set ${round})` : ''} — approved`
          })
          .run()
      }
    })
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
    videoGamesStars: () => ({ stars: videoGamesStars() }),
    setVideoGamesStars,
    purgeCompletionsBefore
  }
}

export type ChoresService = ReturnType<typeof createChoresService>
