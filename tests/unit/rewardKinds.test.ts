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

  it('a static reward costs its price and waits for a parent; it is never bought by the minute', () => {
    const gum = rewards.create({ title: 'Gum', costStars: 5, kind: 'static', bonusMinutes: 9 })
    expect(gum.bonusMinutes).toBe(0)
    rewards.adjust('emma', 7)
    const r = rewards.redeem(gum.id, 'emma')
    expect(r).toMatchObject({ status: 'pending', starsSpent: 5, rewardTitle: 'Gum' })
    expect(chores.balanceOf('emma')).toBe(2)
    expect(rewards.pendingRedemptions().map((x) => x.id)).toEqual([r.id])
    expect(() => rewards.redeem(gum.id, 'emma')).toThrow(/3 more to go/)
    expect(() => rewards.useTime('emma', 1, gum.id)).toThrow(/set price/)
    expect(() => rewards.redeem(VIDEO_GAME_REWARD_ID, 'emma')).toThrow(/by the minute/)
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
