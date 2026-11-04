import { and, asc, eq, gte, isNull } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { AppDb } from '../db/client'
import { countdowns } from '../db/schema'
import { uuidv7 } from '@shared/uuid'
import { isoUtc } from '@shared/dates'
import type { CountdownDto, CountdownInput } from '@shared/types'
import { invalid, notFound } from './errors'

/** Countdowns to dates the family is looking forward to; one drops off once its day has passed. */
export function createCountdownsService(db: AppDb, deviceTz: () => string, today: () => string = () => DateTime.now().setZone(deviceTz()).toISODate()!) {
  function toDto(r: typeof countdowns.$inferSelect): CountdownDto {
    return { id: r.id, title: r.title, emoji: r.emoji, date: r.date }
  }

  /** Today's and future countdowns, soonest first. */
  function list(): CountdownDto[] {
    return db
      .select()
      .from(countdowns)
      .where(and(isNull(countdowns.deletedAt), gte(countdowns.date, today())))
      .orderBy(asc(countdowns.date), asc(countdowns.createdAt))
      .all()
      .map(toDto)
  }

  function clean(input: CountdownInput): CountdownInput {
    const title = input.title.trim()
    if (!title) throw invalid('Give the countdown a name')
    if (input.date < today()) throw invalid('Pick today or a day in the future')
    return { title, emoji: input.emoji || null, date: input.date }
  }

  function create(input: CountdownInput): CountdownDto {
    const c = clean(input)
    const row = { id: uuidv7(), ...c, createdAt: isoUtc(DateTime.utc()), deletedAt: null }
    db.insert(countdowns).values(row).run()
    return toDto(row)
  }

  function update(input: CountdownInput & { id: string }): CountdownDto {
    const c = clean(input)
    const result = db
      .update(countdowns)
      .set(c)
      .where(and(eq(countdowns.id, input.id), isNull(countdowns.deletedAt)))
      .run()
    if (result.changes === 0) throw notFound('Countdown')
    return { id: input.id, ...c }
  }

  function remove(id: string): void {
    db.update(countdowns).set({ deletedAt: isoUtc(DateTime.utc()) }).where(eq(countdowns.id, id)).run()
  }

  return { list, create, update, remove }
}

export type CountdownsService = ReturnType<typeof createCountdownsService>
