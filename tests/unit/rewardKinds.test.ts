import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrations'
import { people } from '../../src/main/db/schema'
import { createChoresService } from '../../src/main/services/choresService'
import { createRewardsService } from '../../src/main/services/rewardsService'
import { dueAlerts } from '../../src/shared/pushAlerts'
import { VIDEO_GAME_REWARD_ID } from '../../src/shared/types'

let handle: DbHandle
let chores: ReturnType<typeof createChoresService>
let rewards: ReturnType<typeof createRewardsService>
beforeEach(() => {
  handle = openDatabase(':memory:')
  handle.db.insert(people).values({ id: 'emma', name: 'Emma', color: '#8E4EC6', role: 'child', sortOrder: 0, createdAt: '2026-01-01T00:00:00Z' }).run()
  chores = createChoresService(handle.db, () => 'America/Regina')
  rewards = createRewardsService(handle.db, chores)
})
afterEach(() => handle.sqlite.close())

describe('Shop rewards: static and dynamic', () => {
  it('starts with Video Game Time: dynamic, 3 bonus minutes, first in the Shop', () => {
    rewards.create({ title: 'Gum', costStars: 5 })
    const list = rewards.list()
    expect(list.map((r) => [r.id === VIDEO_GAME_REWARD_ID ? 'vgt' : r.title, r.kind, r.bonusMinutes])).toEqual([
      ['vgt', 'dynamic', 3],
      ['Gum', 'static', 0]
    ])
    expect(list[0]).toMatchObject({ title: 'Video Game Time', icon: '🎮' })
  })

  it('a dynamic reward: the kid picks the stars, the timer is that many minutes + its own bonus', () => {
    const tv = rewards.create({ title: 'TV Time', costStars: 1, kind: 'dynamic', bonusMinutes: 5, icon: '📺' })
    rewards.adjust('emma', 40)
    expect(rewards.useTime('emma', 10, tv.id)).toMatchObject({ used: 10, minutes: 15 })
    expect(chores.balanceOf('emma')).toBe(30)
    // a second, separate timer for Video Game Time — one per reward
    expect(rewards.useTime('emma', 20)).toMatchObject({ used: 20, minutes: 23 })
    const timers = rewards.timers()
    expect(timers.map((t) => [t.title, t.minutes, t.bonusMinutes, t.points])).toEqual([
      ['TV Time', 15, 5, 10],
      ['Video Game Time', 23, 3, 20]
    ])
    // stopping right away gives back what was spent, not the bonus
    expect(rewards.stopTimer(timers[0].id)).toEqual({ refunded: 10 })
    expect(chores.balanceOf('emma')).toBe(20)
  })

  it('a static reward is asked for at its price; nothing comes off until a parent grants it', () => {
    const gum = rewards.create({ title: 'Gum', costStars: 5, kind: 'static', bonusMinutes: 9 })
    expect(gum.bonusMinutes).toBe(0)
    rewards.adjust('emma', 7)
    const r = rewards.redeem(gum.id, 'emma')
    expect(r).toMatchObject({ status: 'pending', starsSpent: 5, rewardTitle: 'Gum', rewardKind: 'static', minutes: null, charged: false })
    expect(chores.balanceOf('emma')).toBe(7)
    expect(rewards.held('emma')).toBe(5)
    expect(rewards.pendingRedemptions().map((x) => x.id)).toEqual([r.id])
    // asking again for the same thing replaces the request
    expect(rewards.redeem(gum.id, 'emma').id).toBe(r.id)
    expect(rewards.pendingRedemptions()).toHaveLength(1)
    rewards.grant(r.id)
    expect(chores.balanceOf('emma')).toBe(2)
    expect(rewards.pendingRedemptions()).toEqual([])
    expect(() => rewards.redeem(gum.id, 'emma')).toThrow(/3 more to go/)
    expect(() => rewards.useTime('emma', 1, gum.id)).toThrow(/set price/)
    expect(() => rewards.redeem(VIDEO_GAME_REWARD_ID, 'emma')).toThrow(/Pick how many/)
  })

  it('a dynamic request starts its timer only when granted; requests set stars aside', () => {
    rewards.adjust('emma', 40)
    const gum = rewards.create({ title: 'Gum', costStars: 5 })
    const vgt = rewards.redeem(VIDEO_GAME_REWARD_ID, 'emma', 30)
    expect(vgt).toMatchObject({ starsSpent: 30, minutes: 33, rewardKind: 'dynamic', charged: false })
    expect(rewards.timers()).toEqual([])
    expect(chores.balanceOf('emma')).toBe(40)
    // 30 set aside: only 10 left to ask for
    expect(() => rewards.redeem(gum.id, 'emma')).not.toThrow()
    expect(() => rewards.redeem(VIDEO_GAME_REWARD_ID, 'emma', 36)).toThrow(/1 more to go/)
    rewards.grant(vgt.id)
    expect(chores.balanceOf('emma')).toBe(10)
    expect(rewards.timers()).toMatchObject([{ personId: 'emma', minutes: 33, title: 'Video Game Time' }])
  })

  it('a parent can say no: nothing is spent; a request from before (already charged) gets its stars back', () => {
    rewards.adjust('emma', 20)
    const gum = rewards.create({ title: 'Gum', costStars: 5 })
    const r = rewards.redeem(gum.id, 'emma')
    rewards.deny(r.id)
    expect(chores.balanceOf('emma')).toBe(20)
    expect(rewards.pendingRedemptions()).toEqual([])
    expect(() => rewards.grant(r.id)).toThrow()
    // one made before v0.8.164 was charged up front
    handle.sqlite.exec(`INSERT INTO reward_redemptions (id, reward_id, person_id, stars_spent, redeemed_at) VALUES ('old', '${gum.id}', 'emma', 5, '2026-11-06T00:00:00Z')`)
    handle.sqlite.exec(`INSERT INTO star_ledger (id, person_id, delta, reason, created_at) VALUES ('l', 'emma', -5, 'redemption', '2026-11-06T00:00:00Z')`)
    expect(chores.balanceOf('emma')).toBe(15)
    expect(rewards.held('emma')).toBe(0)
    rewards.grant('old')
    expect(chores.balanceOf('emma')).toBe(15)
  })

  it('a grant that the balance no longer covers is refused', () => {
    rewards.adjust('emma', 10)
    const r = rewards.redeem(VIDEO_GAME_REWARD_ID, 'emma', 10)
    rewards.adjust('emma', -4)
    expect(() => rewards.grant(r.id)).toThrow(/Only 6 stars left/)
    expect(rewards.pendingRedemptions()).toHaveLength(1)
  })

  it('a waiting request is a phone notification under approvals', () => {
    const now = Date.parse('2026-11-06T18:00:00Z')
    const alerts = dueAlerts({
      nowMs: now,
      names: new Map([['emma', 'Emma']]),
      approvals: [],
      leaves: [],
      weather: [],
      chat: [],
      timers: [],
      requests: [
        { id: 'q1', personId: 'emma', rewardTitle: 'Video Game Time', starsSpent: 30, minutes: 33 },
        { id: 'q2', personId: 'emma', rewardTitle: 'Gum', starsSpent: 5, minutes: null }
      ]
    })
    expect(alerts.map((a) => [a.key, a.kind, a.title, a.body])).toEqual([
      ['request:q1', 'approvals', '🛒 Emma wants Video Game Time', '⭐ 30 · 33 min — waiting for a parent to OK it'],
      ['request:q2', 'approvals', '🛒 Emma wants Gum', '⭐ 5 — waiting for a parent to OK it']
    ])
  })

  it('switching a reward between kinds keeps its fields sensible', () => {
    const r = rewards.create({ title: 'Park', costStars: 8 })
    expect(rewards.update({ id: r.id, kind: 'dynamic', bonusMinutes: 2 })).toMatchObject({ kind: 'dynamic', bonusMinutes: 2, costStars: 1 })
    expect(rewards.update({ id: r.id, kind: 'static', costStars: 12 })).toMatchObject({ kind: 'static', bonusMinutes: 0, costStars: 12 })
  })

  it('"… is up" names the reward; timers from before keep saying game time', () => {
    const now = Date.parse('2026-11-06T18:00:00Z')
    const s = {
      nowMs: now,
      names: new Map([['emma', 'Emma']]),
      approvals: [],
      leaves: [],
      weather: [],
      chat: [],
      timers: [
        { id: 'a', personId: 'emma', endsAt: new Date(now - 1000).toISOString(), title: 'TV Time' },
        { id: 'b', personId: 'emma', endsAt: new Date(now - 1000).toISOString() }
      ]
    }
    expect(dueAlerts(s).map((a) => [a.title, a.body])).toEqual([
      ["⏳ Emma's TV Time is up", 'Time to stop'],
      ["⏳ Emma's Video Game Time is up", 'Time to put the controller down']
    ])
  })
})

describe('database v14', () => {
  it('requests from before parents approved first count as already charged', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, 13)
    sqlite.exec(`INSERT INTO people (id, name, color, role, sort_order, created_at) VALUES ('p', 'P', '#000', 'child', 0, 'x')`)
    sqlite.exec(`INSERT INTO reward_redemptions (id, reward_id, person_id, stars_spent, redeemed_at) VALUES ('r', 'video-game-time', 'p', 5, 'x')`)
    runMigrations(sqlite, 14)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(14)
    expect(sqlite.prepare('SELECT charged, decided_at AS d, status FROM reward_redemptions').get()).toEqual({ charged: 1, d: null, status: 'pending' })
    sqlite.close()
  })
})

describe('database v13', () => {
  it('a v12 database upgrades: old rewards are static, Video Game Time is added', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, 12)
    sqlite.exec(`INSERT INTO rewards (id, title, cost_stars) VALUES ('r1', 'Ice cream', 15)`)
    runMigrations(sqlite, 13)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(13)
    expect(sqlite.prepare('SELECT id, kind, bonus_minutes AS b, cost_stars AS c FROM rewards ORDER BY sort_order').all()).toEqual([
      { id: VIDEO_GAME_REWARD_ID, kind: 'dynamic', b: 3, c: 1 },
      { id: 'r1', kind: 'static', b: 0, c: 15 }
    ])
    sqlite.close()
  })
})
