import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { people, starLedger } from '../../src/main/db/schema'
import { createChoresService } from '../../src/main/services/choresService'
import { createRewardsService } from '../../src/main/services/rewardsService'

let handle: DbHandle
let chores: ReturnType<typeof createChoresService>
let rewards: ReturnType<typeof createRewardsService>
beforeEach(() => {
  handle = openDatabase(':memory:')
  for (const id of ['emma', 'tom']) {
    handle.db.insert(people).values({ id, name: id, color: '#8E4EC6', role: 'child', sortOrder: 0, createdAt: '2026-01-01T00:00:00Z' }).run()
  }
  chores = createChoresService(handle.db, () => 'America/Regina')
  rewards = createRewardsService(handle.db, chores)
})
afterEach(() => handle.sqlite.close())

describe('use your time', () => {
  it('spends the whole balance, recorded as a spend; the other kid is untouched', () => {
    rewards.adjust('emma', 120)
    rewards.adjust('tom', 40)
    expect(rewards.useTime('emma')).toEqual({ used: 120 })
    expect(chores.balanceOf('emma')).toBe(0)
    expect(chores.balanceOf('tom')).toBe(40)
    const last = handle.db.select().from(starLedger).all().at(-1)!
    expect(last).toMatchObject({ personId: 'emma', delta: -120, reason: 'redemption' })
  })

  it('nothing saved up: nothing happens', () => {
    expect(rewards.useTime('emma')).toEqual({ used: 0 })
    expect(handle.db.select().from(starLedger).all()).toHaveLength(0)
    rewards.adjust('emma', 10)
    rewards.useTime('emma')
    expect(rewards.useTime('emma')).toEqual({ used: 0 }) // a second tap doesn't go negative
    expect(chores.balanceOf('emma')).toBe(0)
  })

  it('an unknown person is refused', () => {
    expect(() => rewards.useTime('nobody')).toThrow()
  })
})
