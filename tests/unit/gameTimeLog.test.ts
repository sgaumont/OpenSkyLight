import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrations'
import { people } from '../../src/main/db/schema'
import { createChoresService } from '../../src/main/services/choresService'
import { createRewardsService } from '../../src/main/services/rewardsService'
import { VIDEO_GAMES_SET_ID } from '../../src/shared/types'
import { COMPANION_CHANNELS } from '../../src/shared/ipc/companionChannels'

const DAY = '2026-11-07'
let handle: DbHandle
let chores: ReturnType<typeof createChoresService>
let rewards: ReturnType<typeof createRewardsService>
beforeEach(() => {
  handle = openDatabase(':memory:')
  for (const [id, name] of [['emma', 'Emma'], ['tom', 'Tom']]) {
    handle.db.insert(people).values({ id, name, color: '#8E4EC6', role: 'child', sortOrder: 0, createdAt: '2026-01-01T00:00:00Z' }).run()
  }
  chores = createChoresService(handle.db, () => 'America/Regina')
  rewards = createRewardsService(handle.db, chores)
})
afterEach(() => handle.sqlite.close())
const lines = (personId: string | null = null) => rewards.log(personId, 100).map((e) => [e.note, e.delta, e.balanceAfter])

describe('game time log', () => {
  it('a tick and an un-tick both show, and the balance comes out the same', () => {
    const bed = chores.create({ title: 'Make bed', starsValue: 3, recurrence: null, anchorDate: DAY })
    chores.complete(bed.id, DAY, 'emma')
    chores.uncomplete(bed.id, DAY)
    expect(lines('emma')).toEqual([
      ['Un-ticked: Make bed', -3, 0],
      ['Make bed', 3, 3]
    ])
    expect(chores.balanceOf('emma')).toBe(0)
  })

  it('Video Games approval, a reward, a parent change and using time, newest first with running balances', () => {
    chores.setVideoGamesStars(60)
    const tasks = ['Room', 'Homework'].map((title) =>
      chores.create({ title, starsValue: 0, recurrence: null, anchorDate: DAY, mode: 'videogames', assignees: ['emma'] })
    )
    for (const t of tasks) chores.complete(t.id, DAY, 'emma')
    chores.approveUnlock(VIDEO_GAMES_SET_ID, 'emma', DAY, 1)
    const reward = rewards.create({ title: 'Ice cream', costStars: 10 })
    rewards.redeem(reward.id, 'emma')
    rewards.adjust('emma', 5)
    rewards.useTime('emma')
    expect(lines('emma')).toEqual([
      ['Used game time (58 min)', -55, 0],
      ['Changed by a parent', 5, 55],
      ['Reward: Ice cream', -10, 50],
      ['🎮 Video Games set — approved', 60, 60]
    ])
  })

  it('a Video Games set taken back shows as its own line', () => {
    chores.setVideoGamesStars(60)
    const tasks = ['Room', 'Homework'].map((title) =>
      chores.create({ title, starsValue: 0, recurrence: null, anchorDate: DAY, mode: 'videogames', assignees: ['emma'] })
    )
    for (const t of tasks) chores.complete(t.id, DAY, 'emma')
    chores.approveUnlock(VIDEO_GAMES_SET_ID, 'emma', DAY, 1)
    chores.uncomplete(tasks[0].id, DAY, 'emma')
    expect(lines('emma')[0]).toEqual(['🎮 Video Games set taken back (a task was un-ticked)', -60, 0])
    expect(chores.balanceOf('emma')).toBe(0)
  })

  it('one kid or everyone; each kid keeps their own running balance', () => {
    rewards.adjust('emma', 10)
    rewards.adjust('tom', 4)
    rewards.adjust('emma', 1)
    expect(rewards.log('tom', 100).map((e) => e.balanceAfter)).toEqual([4])
    expect(rewards.log(null, 100).map((e) => [e.personId, e.balanceAfter])).toEqual([['emma', 11], ['tom', 4], ['emma', 10]])
    expect(rewards.log(null, 2)).toHaveLength(2)
  })

  it('rows from before notes still get a description', () => {
    handle.sqlite.exec(`INSERT INTO star_ledger (id, person_id, delta, reason, ref_id, created_at) VALUES
      ('a','emma',7,'manual_adjust',NULL,'2026-01-01T00:00:00Z'),
      ('b','emma',-7,'redemption',NULL,'2026-01-02T00:00:00Z'),
      ('c','emma',2,'chore','gone','2026-01-03T00:00:00Z')`)
    expect(lines('emma')).toEqual([
      ['Chore', 2, 2],
      ['Used game time', -7, 0],
      ['Changed by a parent', 7, 7]
    ])
  })

  it('a v5 database upgrades to v6, keeping its history', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, 5)
    sqlite.exec(`INSERT INTO people (id, name, color, role, sort_order, created_at) VALUES ('k','K','#000','child',0,'2026-01-01T00:00:00Z');
      INSERT INTO star_ledger (id, person_id, delta, reason, ref_id, created_at) VALUES ('x','k',5,'manual_adjust',NULL,'2026-01-01T00:00:00Z')`)
    runMigrations(sqlite)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(6)
    expect(sqlite.prepare('SELECT delta, note FROM star_ledger').get()).toEqual({ delta: 5, note: null })
    sqlite.close()
  })
})

describe('game time log on the phone', () => {
  it('a paired phone may read the log', () => {
    expect(COMPANION_CHANNELS.has('stars:log')).toBe(true)
  })
})
