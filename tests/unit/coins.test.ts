import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrations'
import { people } from '../../src/main/db/schema'
import { createChoresService } from '../../src/main/services/choresService'
import { createRewardsService } from '../../src/main/services/rewardsService'
import { VIDEO_GAME_REWARD_ID } from '../../src/shared/types'

let handle: DbHandle
let chores: ReturnType<typeof createChoresService>
let rewards: ReturnType<typeof createRewardsService>
beforeEach(() => {
  handle = openDatabase(':memory:')
  for (const [id, name, sortOrder] of [
    ['emma', 'Emma', 0],
    ['noah', 'Noah', 1]
  ] as const) {
    handle.db.insert(people).values({ id, name, color: '#8E4EC6', role: 'child', sortOrder, createdAt: '2026-01-01T00:00:00Z' }).run()
  }
  chores = createChoresService(handle.db, () => 'America/Regina')
  rewards = createRewardsService(handle.db, chores)
})
afterEach(() => handle.sqlite.close())

describe('coins, a second currency beside stars', () => {
  it('a chore pays its stars and its coins; un-ticking takes both back', () => {
    const chore = chores.create({ title: 'Dishes', starsValue: 3, coinsValue: 2, recurrence: { freq: 'daily' }, anchorDate: '2026-06-01' })
    expect(chore.coinsValue).toBe(2)
    expect(chores.getDay('2026-06-10')[0]).toMatchObject({ starsValue: 3, coinsValue: 2 })
    chores.complete(chore.id, '2026-06-10', 'emma')
    expect(chores.balanceOf('emma')).toBe(3)
    expect(chores.balanceOf('emma', 'coins')).toBe(2)
    expect(chores.balances()).toEqual([{ personId: 'emma', balance: 3, coins: 2 }])
    chores.uncomplete(chore.id, '2026-06-10')
    expect(chores.balanceOf('emma')).toBe(0)
    expect(chores.balanceOf('emma', 'coins')).toBe(0)
  })

  it('chores pay no coins unless a parent sets some; coins can be changed later', () => {
    const chore = chores.create({ title: 'Make bed', starsValue: 1, recurrence: { freq: 'daily' }, anchorDate: '2026-06-01' })
    expect(chore.coinsValue).toBe(0)
    chores.complete(chore.id, '2026-06-10', 'emma')
    expect(chores.balanceOf('emma', 'coins')).toBe(0)
    expect(chores.update({ id: chore.id, coinsValue: 4 }).coinsValue).toBe(4)
    chores.complete(chore.id, '2026-06-11', 'emma')
    expect(chores.balanceOf('emma', 'coins')).toBe(4)
    expect(chores.balanceOf('emma')).toBe(2)
  })

  it('Video Games tasks pay neither stars nor coins alone', () => {
    const t = chores.create({ title: 'Homework', starsValue: 5, coinsValue: 5, mode: 'videogames', assignees: ['emma'] })
    expect(t).toMatchObject({ starsValue: 0, coinsValue: 0 })
  })

  it('a coins reward is asked for and paid in coins, leaving stars alone', () => {
    rewards.adjust('emma', 10)
    rewards.adjust('emma', 6, 'coins')
    const toy = rewards.create({ title: 'Toy', costStars: 5, currency: 'coins', icon: '🧸' })
    expect(toy.currency).toBe('coins')
    const ask = rewards.redeem(toy.id, 'emma')
    expect(ask.currency).toBe('coins')
    // coins asked for are set aside: a second coins reward can't use them too
    const gum = rewards.create({ title: 'Gum', costStars: 2, currency: 'coins' })
    expect(() => rewards.redeem(gum.id, 'emma')).toThrow(/Not enough coins/)
    rewards.grant(ask.id)
    expect(chores.balanceOf('emma', 'coins')).toBe(1)
    expect(chores.balanceOf('emma')).toBe(10)
  })

  it("refuses a coins reward the kid can't cover, whatever their stars", () => {
    rewards.adjust('emma', 100)
    const toy = rewards.create({ title: 'Toy', costStars: 5, currency: 'coins' })
    expect(() => rewards.redeem(toy.id, 'emma')).toThrow(/Not enough coins yet — 5 more/)
  })

  it('a denied coins request costs nothing', () => {
    rewards.adjust('emma', 5, 'coins')
    const toy = rewards.create({ title: 'Toy', costStars: 5, currency: 'coins' })
    rewards.deny(rewards.redeem(toy.id, 'emma').id)
    expect(chores.balanceOf('emma', 'coins')).toBe(5)
  })

  it('timed (dynamic) rewards always run on stars', () => {
    const tv = rewards.create({ title: 'TV', costStars: 1, kind: 'dynamic', bonusMinutes: 0, currency: 'coins' })
    expect(tv.currency).toBe('stars')
    const toy = rewards.create({ title: 'Toy', costStars: 5, currency: 'coins' })
    expect(rewards.update({ id: toy.id, kind: 'dynamic' }).currency).toBe('stars')
    expect(rewards.update({ id: VIDEO_GAME_REWARD_ID, currency: 'coins' }).currency).toBe('stars')
    expect(rewards.update({ id: toy.id, kind: 'static', currency: 'coins' }).currency).toBe('coins')
  })

  it('a parent can correct coins without touching stars', () => {
    expect(rewards.adjust('emma', 4, 'coins')).toEqual({ balance: 4 })
    expect(rewards.adjust('emma', -6, 'coins')).toEqual({ balance: -2 })
    expect(rewards.adjust('emma', 3)).toEqual({ balance: 3 })
    expect(chores.balances()).toEqual([{ personId: 'emma', balance: 3, coins: -2 }])
  })

  it('the history marks each line stars or coins, with that currency balance after it', () => {
    rewards.adjust('emma', 5)
    rewards.adjust('emma', 2, 'coins')
    rewards.adjust('emma', 1, 'coins')
    const log = rewards.log('emma', 10)
    expect(log.map((e) => [e.currency, e.delta, e.balanceAfter])).toEqual([
      ['coins', 1, 3],
      ['coins', 2, 2],
      ['stars', 5, 5]
    ])
  })
})

describe('database v15', () => {
  it('everything from before is stars, and chores pay no coins', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, 14)
    sqlite.exec(`INSERT INTO people (id, name, color, role, sort_order, created_at) VALUES ('p', 'P', '#000', 'child', 0, 'x')`)
    sqlite.exec(`INSERT INTO star_ledger (id, person_id, delta, reason, created_at) VALUES ('l', 'p', 7, 'manual_adjust', 'x')`)
    sqlite.exec(`INSERT INTO chores (id, title, stars_value, created_at) VALUES ('c', 'Dishes', 2, 'x')`)
    sqlite.exec(`INSERT INTO rewards (id, title, cost_stars) VALUES ('r', 'Gum', 5)`)
    sqlite.exec(`INSERT INTO reward_redemptions (id, reward_id, person_id, stars_spent, redeemed_at) VALUES ('q', 'r', 'p', 5, 'x')`)
    runMigrations(sqlite, 15)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(15)
    expect(sqlite.prepare('SELECT currency FROM star_ledger').get()).toEqual({ currency: 'stars' })
    expect(sqlite.prepare('SELECT coins_value AS c FROM chores').get()).toEqual({ c: 0 })
    expect(sqlite.prepare(`SELECT currency FROM rewards WHERE id = 'r'`).get()).toEqual({ currency: 'stars' })
    expect(sqlite.prepare('SELECT currency FROM reward_redemptions').get()).toEqual({ currency: 'stars' })
    sqlite.close()
  })
})
