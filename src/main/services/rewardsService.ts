import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { AppDb } from '../db/client'
import { choreCompletions, chores, people, rewardRedemptions, rewards, settings, starLedger, videoGameRounds } from '../db/schema'
import { uuidv7 } from '@shared/uuid'
import { isoUtc } from '@shared/dates'
import { VIDEO_GAME_REWARD_ID, type GameTimeLogEntry, type GameTimerDto, type RedemptionDto, type RewardDto, type RewardKind } from '@shared/types'
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
    const spent = timer ? (timer.points ?? Math.max(0, timer.minutes - (timer.bonusMinutes ?? SETUP_MINUTES))) : 0
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
            note: `${timer.title && timer.rewardId !== VIDEO_GAME_REWARD_ID ? timer.title : 'Game time'} stopped early (${minutesLabel(refunded)} back)`
          })
          .run()
      }
      putSetting(KEY_TIMERS, JSON.stringify(list.filter((t) => t.id !== id)))
    })
    return { refunded }
  }

  function toDto(row: typeof rewards.$inferSelect): RewardDto {
    return { id: row.id, title: row.title, icon: row.icon, costStars: row.costStars, active: row.active, kind: row.kind, bonusMinutes: row.bonusMinutes }
  }

  function list(): RewardDto[] {
    return db
      .select()
      .from(rewards)
      .where(and(isNull(rewards.deletedAt), eq(rewards.active, true)))
      // Video Game Time first (sort_order -1), then in the order they were added (ids are time-ordered)
      .orderBy(asc(rewards.sortOrder), asc(rewards.id))
      .all()
      .map(toDto)
  }

  type RewardInput = { title: string; costStars: number; kind?: RewardKind; bonusMinutes?: number; icon?: string | null }

  function create(input: RewardInput): RewardDto {
    const id = uuidv7()
    const kind = input.kind ?? 'static'
    db.insert(rewards)
      .values({
        id,
        title: input.title,
        icon: input.icon ?? null,
        costStars: kind === 'dynamic' ? 1 : input.costStars,
        active: true,
        kind,
        bonusMinutes: kind === 'dynamic' ? (input.bonusMinutes ?? 0) : 0
      })
      .run()
    const [row] = db.select().from(rewards).where(eq(rewards.id, id)).all()
    return toDto(row)
  }

  function update(input: { id: string } & Partial<RewardInput> & { active?: boolean }): RewardDto {
    const patch: Partial<typeof rewards.$inferInsert> = {}
    if (input.title !== undefined) patch.title = input.title
    if (input.costStars !== undefined) patch.costStars = input.costStars
    if (input.active !== undefined) patch.active = input.active
    if (input.kind !== undefined) patch.kind = input.kind
    if (input.bonusMinutes !== undefined) patch.bonusMinutes = input.bonusMinutes
    if (input.icon !== undefined) patch.icon = input.icon
    // a static reward has no bonus time; a dynamic one's cost is picked by the kid
    if (input.kind === 'static') patch.bonusMinutes = 0
    if (input.kind === 'dynamic') patch.costStars = 1
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

  function redemptionDto(row: typeof rewardRedemptions.$inferSelect, reward: typeof rewards.$inferSelect): RedemptionDto {
    const dynamic = reward.kind === 'dynamic'
    return {
      id: row.id,
      rewardId: row.rewardId,
      rewardTitle: reward.title,
      rewardKind: reward.kind,
      personId: row.personId,
      starsSpent: row.starsSpent,
      minutes: dynamic ? gameMinutes(row.starsSpent, reward.bonusMinutes).total : null,
      redeemedAt: row.redeemedAt,
      status: row.status,
      charged: row.charged
    }
  }

  /** Stars a kid has asked for and a parent hasn't decided on yet — set aside, not spent. */
  function held(personId: string, exceptId?: string): number {
    return db
      .select()
      .from(rewardRedemptions)
      .where(and(eq(rewardRedemptions.personId, personId), eq(rewardRedemptions.status, 'pending'), eq(rewardRedemptions.charged, false)))
      .all()
      .filter((r) => r.id !== exceptId)
      .reduce((n, r) => n + r.starsSpent, 0)
  }

  /**
   * A kid asks to buy something in the Shop: a static reward at its price, a dynamic one for the
   * stars they picked. Nothing comes off yet — a parent grants or denies it. The stars are set
   * aside meanwhile, so they can't be asked for twice; asking again for the same reward replaces
   * the earlier request.
   */
  function redeem(rewardId: string, personId: string, stars?: number): RedemptionDto {
    const [reward] = db.select().from(rewards).where(and(eq(rewards.id, rewardId), isNull(rewards.deletedAt))).all()
    if (!reward) throw notFound('Reward')
    const [person] = db.select().from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).all()
    if (!person) throw notFound('Person')
    if (reward.kind === 'dynamic' && !stars) throw invalid(`Pick how many stars to spend on ${reward.title}`)
    const want = reward.kind === 'dynamic' ? stars! : reward.costStars
    const [earlier] = db
      .select()
      .from(rewardRedemptions)
      .where(
        and(
          eq(rewardRedemptions.personId, personId),
          eq(rewardRedemptions.rewardId, rewardId),
          eq(rewardRedemptions.status, 'pending'),
          eq(rewardRedemptions.charged, false)
        )
      )
      .all()
    const available = choresService.balanceOf(personId) - held(personId, earlier?.id)
    if (available < want) throw invalid(`Not enough stars yet — ${want - available} more to go!`)
    const now = isoUtc(DateTime.utc())
    const id = earlier?.id ?? uuidv7()
    if (earlier) {
      db.update(rewardRedemptions).set({ starsSpent: want, redeemedAt: now }).where(eq(rewardRedemptions.id, id)).run()
    } else {
      db.insert(rewardRedemptions).values({ id, rewardId, personId, starsSpent: want, redeemedAt: now, status: 'pending', charged: false }).run()
    }
    const [row] = db.select().from(rewardRedemptions).where(eq(rewardRedemptions.id, id)).all()
    return redemptionDto(row, reward)
  }

  /** Purchases waiting for a parent, newest first. */
  function pendingRedemptions(): RedemptionDto[] {
    const rows = db
      .select({ redemption: rewardRedemptions, reward: rewards })
      .from(rewardRedemptions)
      .innerJoin(rewards, eq(rewards.id, rewardRedemptions.rewardId))
      .where(eq(rewardRedemptions.status, 'pending'))
      .orderBy(desc(rewardRedemptions.redeemedAt))
      .all()
    return rows.map((r) => redemptionDto(r.redemption, r.reward))
  }

  function pending(redemptionId: string): { row: typeof rewardRedemptions.$inferSelect; reward: typeof rewards.$inferSelect } {
    const [hit] = db
      .select({ row: rewardRedemptions, reward: rewards })
      .from(rewardRedemptions)
      .innerJoin(rewards, eq(rewards.id, rewardRedemptions.rewardId))
      .where(and(eq(rewardRedemptions.id, redemptionId), eq(rewardRedemptions.status, 'pending')))
      .all()
    if (!hit) throw notFound('Request')
    return hit
  }

  /**
   * A parent says yes: the stars come off now (unless they already did, on a request from before
   * parents approved first), and a dynamic reward's timer starts.
   */
  function grant(redemptionId: string): void {
    const { row, reward } = pending(redemptionId)
    const now = isoUtc(DateTime.utc())
    if (!row.charged) {
      const balance = choresService.balanceOf(row.personId)
      if (balance < row.starsSpent) throw invalid(`Only ${balance} ${balance === 1 ? 'star' : 'stars'} left now — not enough for this`)
    }
    db.transaction(() => {
      if (!row.charged) {
        if (reward.kind === 'dynamic') {
          // takes the stars off and starts (or tops up) their timer for this reward
          useTime(row.personId, row.starsSpent, reward.id)
        } else {
          db.insert(starLedger)
            .values({
              id: uuidv7(),
              personId: row.personId,
              delta: -row.starsSpent,
              reason: 'redemption',
              refId: row.id,
              createdAt: now,
              note: `Reward: ${reward.title}`
            })
            .run()
        }
      }
      db.update(rewardRedemptions).set({ status: 'granted', charged: true, decidedAt: now }).where(eq(rewardRedemptions.id, row.id)).run()
    })
  }

  /** A parent says no: nothing is spent (a request from before, already charged, gets its stars back). */
  function deny(redemptionId: string): void {
    const { row, reward } = pending(redemptionId)
    const now = isoUtc(DateTime.utc())
    db.transaction(() => {
      if (row.charged) {
        db.insert(starLedger)
          .values({
            id: uuidv7(),
            personId: row.personId,
            delta: row.starsSpent,
            reason: 'redemption',
            refId: row.id,
            createdAt: now,
            note: `Reward not given: ${reward.title}`
          })
          .run()
      }
      db.update(rewardRedemptions).set({ status: 'denied', decidedAt: now }).where(eq(rewardRedemptions.id, row.id)).run()
    })
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
   * A kid spends some of their saved-up stars (all of them when `stars` is left out) on a dynamic
   * reward (Video Game Time when none is named): that many come off their balance and a timer
   * starts — 1 minute a star plus the reward's bonus minutes. Only ever lowers a balance, so it
   * needs no parent PIN. A kid already on that reward gets the new minutes added to their running
   * timer. Asking for more than they have spends what they have.
   */
  function useTime(
    personId: string,
    stars?: number,
    rewardId: string = VIDEO_GAME_REWARD_ID
  ): { used: number; minutes: number; timer: GameTimerDto | null } {
    const [person] = db.select().from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).all()
    if (!person) throw notFound('Person')
    const [reward] = db.select().from(rewards).where(and(eq(rewards.id, rewardId), isNull(rewards.deletedAt))).all()
    if (!reward) throw notFound('Reward')
    if (reward.kind !== 'dynamic') throw invalid(`${reward.title} has a set price`)
    const balance = Math.min(choresService.balanceOf(personId), stars ?? Infinity)
    if (balance <= 0) return { used: 0, minutes: 0, timer: null }
    const bonus = reward.bonusMinutes
    const total = gameMinutes(balance, bonus).total
    const now = DateTime.utc()
    const list = timers()
    // timers from before rewards had kinds were all Video Game Time
    const sameReward = (t: GameTimerDto): boolean => t.personId === personId && (t.rewardId ?? VIDEO_GAME_REWARD_ID) === rewardId
    const running = list.find((t) => sameReward(t) && DateTime.fromISO(t.endsAt) > now)
    const timer: GameTimerDto = running
      ? {
          ...running,
          rewardId,
          title: reward.title,
          minutes: running.minutes + total,
          points: (running.points ?? Math.max(0, running.minutes - (running.bonusMinutes ?? SETUP_MINUTES))) + balance,
          bonusMinutes: (running.bonusMinutes ?? SETUP_MINUTES) + bonus,
          endsAt: isoUtc(DateTime.fromISO(running.endsAt).plus({ minutes: total }))
        }
      : {
          id: uuidv7(),
          personId,
          startedAt: isoUtc(now),
          endsAt: isoUtc(now.plus({ minutes: total })),
          minutes: total,
          points: balance,
          rewardId,
          title: reward.title,
          bonusMinutes: bonus
        }
    db.transaction(() => {
      db.insert(starLedger)
        .values({
          id: uuidv7(),
          personId,
          delta: -balance,
          reason: 'redemption',
          refId: timer.id,
          createdAt: isoUtc(now),
          note: `Used ${reward.id === VIDEO_GAME_REWARD_ID ? 'game time' : reward.title} (${minutesLabel(total)})`
        })
        .run()
      // a finished, unacknowledged timer of theirs for this reward makes way for the new one
      putSetting(KEY_TIMERS, JSON.stringify([...list.filter((t) => !sameReward(t)), timer]))
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

  return { list, create, update, remove, redeem, pendingRedemptions, grant, deny, held, adjust, useTime, log, timers, stopTimer }
}

export type RewardsService = ReturnType<typeof createRewardsService>
