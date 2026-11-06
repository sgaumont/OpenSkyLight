import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { AppDb } from '../db/client'
import { choreCompletions, chores, people, rewardRedemptions, rewards, settings, starLedger, videoGameRounds } from '../db/schema'
import { uuidv7 } from '@shared/uuid'
import { isoUtc } from '@shared/dates'
import type { GameTimeLogEntry, GameTimerDto, RedemptionDto, RewardDto } from '@shared/types'
import { SETUP_MINUTES, gameMinutes, minutesLabel, refundPoints } from '@shared/gameTime'
import type { ChoresService } from './choresService'
import { invalid, notFound } from './errors'

const KEY_TIMERS = 'gameTime.timers'

export function createRewardsService(db: AppDb, choresService: ChoresService) {
  function getSetting(key: string): string | null {
    const [row] = db.select().from(settings).where(eq(settings.key, key)).all()
    return row?.value ?? null
  }

  function putSetting(key: string, value: string): void {
    db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run()
  }

  /** Game timers running (or finished and not yet acknowledged), kept by the kiosk so a restart doesn't lose them. */
  function timers(): GameTimerDto[] {
    try {
      const list: unknown = JSON.parse(getSetting(KEY_TIMERS) ?? '[]')
      return Array.isArray(list) ? (list as GameTimerDto[]) : []
    } catch {
      return []
    }
  }

  /**
   * Stop a timer early — the time left comes back as controllers, rounded up to a whole minute (no
   * more than was spent) — or put away one whose time is up (nothing back).
   */
  function stopTimer(id: string): { refunded: number } {
    const list = timers()
    const timer = list.find((t) => t.id === id)
    const now = DateTime.utc()
    const spent = timer ? (timer.points ?? Math.max(0, timer.minutes - SETUP_MINUTES)) : 0
    const refunded = timer ? refundPoints(DateTime.fromISO(timer.endsAt).toMillis() - now.toMillis(), spent) : 0
    db.transaction(() => {
      if (timer && refunded > 0) {
        db.insert(starLedger)
          .values({
            id: uuidv7(),
            personId: timer.personId,
            delta: refunded,
            reason: 'redemption',
            refId: timer.id,
            createdAt: isoUtc(now),
            note: `Game time stopped early (${minutesLabel(refunded)} back)`
          })
          .run()
      }
      putSetting(KEY_TIMERS, JSON.stringify(list.filter((t) => t.id !== id)))
    })
    return { refunded }
  }

  function toDto(row: typeof rewards.$inferSelect): RewardDto {
    return { id: row.id, title: row.title, icon: row.icon, costStars: row.costStars, active: row.active }
  }

  function list(): RewardDto[] {
    return db
      .select()
      .from(rewards)
      .where(and(isNull(rewards.deletedAt), eq(rewards.active, true)))
      .orderBy(asc(rewards.costStars), asc(rewards.sortOrder))
      .all()
      .map(toDto)
  }

  function create(input: { title: string; costStars: number }): RewardDto {
    const id = uuidv7()
    db.insert(rewards).values({ id, title: input.title, costStars: input.costStars, active: true }).run()
    const [row] = db.select().from(rewards).where(eq(rewards.id, id)).all()
    return toDto(row)
  }

  function update(input: { id: string; title?: string; costStars?: number; active?: boolean }): RewardDto {
    const patch: Partial<typeof rewards.$inferInsert> = {}
    if (input.title !== undefined) patch.title = input.title
    if (input.costStars !== undefined) patch.costStars = input.costStars
    if (input.active !== undefined) patch.active = input.active
    const result = db
      .update(rewards)
      .set(patch)
      .where(and(eq(rewards.id, input.id), isNull(rewards.deletedAt)))
      .run()
    if (result.changes === 0) throw notFound('Reward')
    const [row] = db.select().from(rewards).where(eq(rewards.id, input.id)).all()
    return toDto(row)
  }

  function remove(id: string): void {
    const result = db
      .update(rewards)
      .set({ deletedAt: isoUtc(DateTime.utc()) })
      .where(and(eq(rewards.id, id), isNull(rewards.deletedAt)))
      .run()
    if (result.changes === 0) throw notFound('Reward')
  }

  function redemptionDto(
    row: typeof rewardRedemptions.$inferSelect,
    rewardTitle: string
  ): RedemptionDto {
    return {
      id: row.id,
      rewardId: row.rewardId,
      rewardTitle,
      personId: row.personId,
      starsSpent: row.starsSpent,
      redeemedAt: row.redeemedAt,
      status: row.status
    }
  }

  function redeem(rewardId: string, personId: string): RedemptionDto {
    const [reward] = db.select().from(rewards).where(and(eq(rewards.id, rewardId), isNull(rewards.deletedAt))).all()
    if (!reward) throw notFound('Reward')
    const balance = choresService.balanceOf(personId)
    if (balance < reward.costStars) {
      throw invalid(`Not enough game time yet — ${reward.costStars - balance} more to go!`)
    }
    const id = uuidv7()
    const now = isoUtc(DateTime.utc())
    db.transaction((tx) => {
      tx.insert(rewardRedemptions)
        .values({ id, rewardId, personId, starsSpent: reward.costStars, redeemedAt: now, status: 'pending' })
        .run()
      tx.insert(starLedger)
        .values({
          id: uuidv7(),
          personId,
          delta: -reward.costStars,
          reason: 'redemption',
          refId: id,
          createdAt: now,
          note: `Reward: ${reward.title}`
        })
        .run()
    })
    const [row] = db.select().from(rewardRedemptions).where(eq(rewardRedemptions.id, id)).all()
    return redemptionDto(row, reward.title)
  }

  function pendingRedemptions(): RedemptionDto[] {
    const rows = db
      .select({ redemption: rewardRedemptions, rewardTitle: rewards.title })
      .from(rewardRedemptions)
      .innerJoin(rewards, eq(rewards.id, rewardRedemptions.rewardId))
      .where(eq(rewardRedemptions.status, 'pending'))
      .orderBy(desc(rewardRedemptions.redeemedAt))
      .all()
    return rows.map((r) => redemptionDto(r.redemption, r.rewardTitle))
  }

  function grant(redemptionId: string): void {
    const result = db
      .update(rewardRedemptions)
      .set({ status: 'granted' })
      .where(and(eq(rewardRedemptions.id, redemptionId), eq(rewardRedemptions.status, 'pending')))
      .run()
    if (result.changes === 0) throw notFound('Redemption')
  }

  /** A parent's manual correction, kept in the ledger like every other change; may go below zero. */
  function adjust(personId: string, delta: number): { balance: number } {
    const [person] = db.select().from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).all()
    if (!person) throw notFound('Person')
    const balance = choresService.balanceOf(personId)
    if (delta === 0) return { balance }
    db.insert(starLedger)
      .values({
        id: uuidv7(),
        personId,
        delta,
        reason: 'manual_adjust',
        refId: null,
        createdAt: isoUtc(DateTime.utc()),
        note: 'Changed by a parent'
      })
      .run()
    return { balance: balance + delta }
  }

  /**
   * A kid spends all their saved-up controllers on game time: their balance goes to 0 and a game
   * timer starts (play minutes + setup). Only ever lowers a balance, so it needs no parent PIN.
   * A kid already playing gets the new minutes added to their running timer.
   */
  function useTime(personId: string): { used: number; minutes: number; timer: GameTimerDto | null } {
    const [person] = db.select().from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).all()
    if (!person) throw notFound('Person')
    const balance = choresService.balanceOf(personId)
    if (balance <= 0) return { used: 0, minutes: 0, timer: null }
    const { total } = gameMinutes(balance)
    const now = DateTime.utc()
    const list = timers()
    const running = list.find((t) => t.personId === personId && DateTime.fromISO(t.endsAt) > now)
    const timer: GameTimerDto = running
      ? {
          ...running,
          minutes: running.minutes + total,
          points: (running.points ?? Math.max(0, running.minutes - SETUP_MINUTES)) + balance,
          endsAt: isoUtc(DateTime.fromISO(running.endsAt).plus({ minutes: total }))
        }
      : { id: uuidv7(), personId, startedAt: isoUtc(now), endsAt: isoUtc(now.plus({ minutes: total })), minutes: total, points: balance }
    db.transaction(() => {
      db.insert(starLedger)
        .values({
          id: uuidv7(),
          personId,
          delta: -balance,
          reason: 'redemption',
          refId: timer.id,
          createdAt: isoUtc(now),
          note: `Used game time (${minutesLabel(total)})`
        })
        .run()
      // a finished, unacknowledged timer of theirs makes way for the new one
      putSetting(KEY_TIMERS, JSON.stringify([...list.filter((t) => t.personId !== personId), timer]))
    })
    return { used: balance, minutes: total, timer }
  }

  /**
   * The game time log: every gain, loss and use, newest first, each with the kid's balance right
   * after it. Rows from before notes were kept get a best-guess description.
   */
  function log(personId: string | null, limit: number): GameTimeLogEntry[] {
    const rows = db
      .select()
      .from(starLedger)
      .where(personId ? eq(starLedger.personId, personId) : undefined)
      .orderBy(asc(starLedger.createdAt), asc(sql`rowid`))
      .all()
    const running = new Map<string, number>()
    const entries = rows.map((r) => {
      const after = (running.get(r.personId) ?? 0) + r.delta
      running.set(r.personId, after)
      // notes saved before v0.8.153 have 🎮 where stars are shown as ⭐ now
      return { id: r.id, personId: r.personId, delta: r.delta, at: r.createdAt, note: (r.note ?? describe(r)).replace(/🎮/gu, '⭐'), balanceAfter: after }
    })
    return entries.reverse().slice(0, limit)
  }

  /** For rows written before notes: what they were for, as far as can still be told. */
  function describe(r: typeof starLedger.$inferSelect): string {
    if (r.reason === 'manual_adjust') return 'Changed by a parent'
    if (r.reason === 'redemption') {
      if (!r.refId) return 'Used game time'
      const [row] = db
        .select({ title: rewards.title })
        .from(rewardRedemptions)
        .innerJoin(rewards, eq(rewards.id, rewardRedemptions.rewardId))
        .where(eq(rewardRedemptions.id, r.refId))
        .all()
      return row ? `Reward: ${row.title}` : 'Reward'
    }
    if (r.refId) {
      const [done] = db
        .select({ title: chores.title })
        .from(choreCompletions)
        .innerJoin(chores, eq(chores.id, choreCompletions.choreId))
        .where(eq(choreCompletions.id, r.refId))
        .all()
      if (done) return done.title
      const [round] = db.select().from(videoGameRounds).where(eq(videoGameRounds.id, r.refId)).all()
      if (round) return '⭐ Video Games set — approved'
    }
    return 'Chore'
  }

  return { list, create, update, remove, redeem, pendingRedemptions, grant, adjust, useTime, log, timers, stopTimer }
}

export type RewardsService = ReturnType<typeof createRewardsService>
