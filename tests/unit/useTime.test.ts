import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { people, starLedger } from '../../src/main/db/schema'
import { createChoresService } from '../../src/main/services/choresService'
import { createRewardsService } from '../../src/main/services/rewardsService'
import { SETUP_MINUTES, gameMinutes, minutesLabel } from '../../src/shared/gameTime'

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

describe('game time minutes', () => {
  it('1 controller = 1 minute, plus 3 to set up; nothing for nothing', () => {
    expect(SETUP_MINUTES).toBe(3)
    expect(gameMinutes(60)).toEqual({ play: 60, total: 63 })
    expect(gameMinutes(0)).toEqual({ play: 0, total: 0 })
    expect(minutesLabel(63)).toBe('1 h 03 min')
    expect(minutesLabel(45)).toBe('45 min')
  })
})

describe('use your time', () => {
  it('spends the whole balance, logs the minutes, and starts a timer; the other kid is untouched', () => {
    rewards.adjust('emma', 120)
    rewards.adjust('tom', 40)
    const before = Date.now()
    const res = rewards.useTime('emma')
    expect(res).toMatchObject({ used: 120, minutes: 123 })
    expect(chores.balanceOf('emma')).toBe(0)
    expect(chores.balanceOf('tom')).toBe(40)
    const last = handle.db.select().from(starLedger).all().at(-1)!
    expect(last).toMatchObject({ personId: 'emma', delta: -120, reason: 'redemption', note: 'Used game time (2 h 03 min)' })
    const [timer] = rewards.timers()
    expect(timer).toMatchObject({ personId: 'emma', minutes: 123 })
    const length = Date.parse(timer.endsAt) - Date.parse(timer.startedAt)
    expect(length).toBe(123 * 60_000)
    expect(Date.parse(timer.startedAt)).toBeGreaterThanOrEqual(before - 1000)
  })

  it('using more time while still playing adds to the running timer', () => {
    rewards.adjust('emma', 30)
    const first = rewards.useTime('emma').timer!
    rewards.adjust('emma', 10)
    rewards.useTime('emma')
    const timers = rewards.timers()
    expect(timers).toHaveLength(1)
    expect(timers[0]).toMatchObject({ id: first.id, minutes: 33 + 13 })
    expect(Date.parse(timers[0].endsAt) - Date.parse(first.endsAt)).toBe(13 * 60_000)
  })

  it('each kid has their own timer; Stop removes one', () => {
    rewards.adjust('emma', 30)
    rewards.adjust('tom', 20)
    rewards.useTime('emma')
    const tom = rewards.useTime('tom').timer!
    expect(rewards.timers().map((t) => t.personId).sort()).toEqual(['emma', 'tom'])
    rewards.stopTimer(tom.id)
    expect(rewards.timers().map((t) => t.personId)).toEqual(['emma'])
  })

  it('a finished timer left un-acknowledged makes way for a new one', () => {
    rewards.adjust('emma', 5)
    const old = rewards.useTime('emma').timer!
    // pretend it ran out an hour ago
    handle.sqlite
      .prepare("UPDATE settings SET value = ? WHERE key = 'gameTime.timers'")
      .run(JSON.stringify([{ ...old, endsAt: DateTime.utc().minus({ hours: 1 }).toISO() }]))
    rewards.adjust('emma', 10)
    const fresh = rewards.useTime('emma').timer!
    expect(fresh.id).not.toBe(old.id)
    expect(rewards.timers()).toHaveLength(1)
  })

  it('nothing saved up: nothing happens', () => {
    expect(rewards.useTime('emma')).toEqual({ used: 0, minutes: 0, timer: null })
    expect(handle.db.select().from(starLedger).all()).toHaveLength(0)
    expect(rewards.timers()).toEqual([])
  })

  it('an unknown person is refused', () => {
    expect(() => rewards.useTime('nobody')).toThrow()
  })
})
