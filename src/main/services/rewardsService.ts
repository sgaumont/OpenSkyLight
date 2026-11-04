import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { AppDb } from '../db/client'
import { people, rewardRedemptions, rewards, starLedger } from '../db/schema'
import { uuidv7 } from '@shared/uuid'
import { isoUtc } from '@shared/dates'
import type { RedemptionDto, RewardDto } from '@shared/types'
import type { ChoresService } from './choresService'
import { invalid, notFound } from './errors'

export function createRewardsService(db: AppDb, choresService: ChoresService) {
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
      throw invalid(`Not enough stars yet — ${reward.costStars - balance} more to go!`)
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
          createdAt: now
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
        createdAt: isoUtc(DateTime.utc())
      })
      .run()
    return { balance: balance + delta }
  }

  /**
   * A kid spends all their saved-up controllers on game time: their balance goes to 0. Only ever
   * lowers a balance, so it needs no parent PIN. Returns how many were used.
   */
  function useTime(personId: string): { used: number } {
    const [person] = db.select().from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).all()
    if (!person) throw notFound('Person')
    const balance = choresService.balanceOf(personId)
    if (balance <= 0) return { used: 0 }
    db.insert(starLedger)
      .values({ id: uuidv7(), personId, delta: -balance, reason: 'redemption', refId: null, createdAt: isoUtc(DateTime.utc()) })
      .run()
    return { used: balance }
  }

  return { list, create, update, remove, redeem, pendingRedemptions, grant, adjust, useTime }
}

export type RewardsService = ReturnType<typeof createRewardsService>
