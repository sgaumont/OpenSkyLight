import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { createChoresService, type ChoresService } from '../../src/main/services/choresService'
import { createRewardsService, type RewardsService } from '../../src/main/services/rewardsService'

const CHI = 'America/Chicago'

describe('chores + rewards', () => {
  let handle: DbHandle
  let chores: ChoresService
  let rewards: RewardsService

  beforeEach(() => {
    handle = openDatabase(':memory:')
    chores = createChoresService(handle.db, () => CHI)
    rewards = createRewardsService(handle.db, chores)
    handle.sqlite
      .prepare(
        "INSERT INTO people (id, name, color, role, sort_order, created_at) VALUES ('kid1','Emma','#46A758','child',0,'2026-01-01T00:00:00Z')"
      )
      .run()
    handle.sqlite
      .prepare(
        "INSERT INTO people (id, name, color, role, sort_order, created_at) VALUES ('kid2','Noah','#0091FF','child',1,'2026-01-01T00:00:00Z')"
      )
      .run()
  })

  it('daily chores are due every day from their anchor', () => {
    chores.create({ title: 'Make bed', starsValue: 2, recurrence: { freq: 'daily' }, anchorDate: '2026-06-08' })
    expect(chores.getDay('2026-06-07')).toHaveLength(0) // before anchor
    expect(chores.getDay('2026-06-08')).toHaveLength(1)
    expect(chores.getDay('2026-06-20')).toHaveLength(1)
  })

  it('weekly chores are due only on their weekdays', () => {
    // 2026-06-08 is a Monday; byWeekdays 0=Mon, 4=Fri
    chores.create({
      title: 'Trash out',
      starsValue: 5,
      recurrence: { freq: 'weekly', byWeekdays: [0, 4] },
      anchorDate: '2026-06-08'
    })
    expect(chores.getDay('2026-06-08')).toHaveLength(1) // Mon
    expect(chores.getDay('2026-06-09')).toHaveLength(0) // Tue
    expect(chores.getDay('2026-06-12')).toHaveLength(1) // Fri
    expect(chores.getDay('2026-06-15')).toHaveLength(1) // next Mon
  })

  it('one-time chores appear only on the anchor date', () => {
    chores.create({ title: 'Clean garage', starsValue: 10, recurrence: null, anchorDate: '2026-06-10' })
    expect(chores.getDay('2026-06-10')).toHaveLength(1)
    expect(chores.getDay('2026-06-11')).toHaveLength(0)
  })

  it('completing awards stars exactly once and uncompleting reverses', () => {
    const chore = chores.create({
      title: 'Dishes',
      starsValue: 3,
      recurrence: { freq: 'daily' },
      anchorDate: '2026-06-01' // fixed: getDay below uses fixed dates, so the anchor must not be "today"
    })
    expect(chores.complete(chore.id, '2026-06-10', 'kid1').balance).toBe(3)
    expect(chores.complete(chore.id, '2026-06-10', 'kid1').balance).toBe(3) // idempotent
    expect(chores.complete(chore.id, '2026-06-11', 'kid1').balance).toBe(6) // different day counts
    expect(chores.getDay('2026-06-10')[0].completed).toBe(true)
    expect(chores.uncomplete(chore.id, '2026-06-10').balance).toBe(3)
    expect(chores.getDay('2026-06-10')[0].completed).toBe(false)
  })

  it('balance equals the ledger sum across chores and redemptions', () => {
    const chore = chores.create({ title: 'Dishes', starsValue: 10, recurrence: { freq: 'daily' } })
    chores.complete(chore.id, '2026-06-10', 'kid1')
    chores.complete(chore.id, '2026-06-11', 'kid1')
    const reward = rewards.create({ title: 'Ice cream', costStars: 15 })
    rewards.redeem(reward.id, 'kid1')
    expect(chores.balanceOf('kid1')).toBe(5)
  })

  it('refuses redemptions the balance cannot cover', () => {
    const reward = rewards.create({ title: 'Bike', costStars: 100 })
    expect(() => rewards.redeem(reward.id, 'kid1')).toThrow(/Not enough stars/)
    expect(chores.balanceOf('kid1')).toBe(0)
  })

  it('tracks pending redemptions until granted', () => {
    const chore = chores.create({ title: 'Dishes', starsValue: 20, recurrence: { freq: 'daily' } })
    chores.complete(chore.id, '2026-06-10', 'kid1')
    const reward = rewards.create({ title: 'Ice cream', costStars: 15 })
    const redemption = rewards.redeem(reward.id, 'kid1')
    expect(rewards.pendingRedemptions()).toHaveLength(1)
    expect(rewards.pendingRedemptions()[0].rewardTitle).toBe('Ice cream')
    rewards.grant(redemption.id)
    expect(rewards.pendingRedemptions()).toHaveLength(0)
  })

  it('chores belong to no one: whoever checks one off claims it and its stars', () => {
    const chore = chores.create({ title: 'Dishes', starsValue: 4, recurrence: { freq: 'daily' }, anchorDate: '2026-06-01' })
    expect(chore).not.toHaveProperty('personId')
    expect(chores.getDay('2026-06-10')[0]).toMatchObject({ completed: false, completedBy: null })
    expect(chores.complete(chore.id, '2026-06-10', 'kid2').balance).toBe(4)
    expect(chores.getDay('2026-06-10')[0]).toMatchObject({ completed: true, completedBy: 'kid2' })
    expect(chores.complete(chore.id, '2026-06-11', 'kid1').balance).toBe(4) // tomorrow someone else can claim it
    expect(chores.balanceOf('kid2')).toBe(4)
  })

  it("a second claim doesn't steal a chore already done that day", () => {
    const chore = chores.create({ title: 'Dishes', starsValue: 4, recurrence: { freq: 'daily' }, anchorDate: '2026-06-01' })
    chores.complete(chore.id, '2026-06-10', 'kid1')
    expect(chores.complete(chore.id, '2026-06-10', 'kid2').balance).toBe(4) // kid1's balance — their claim stands
    expect(chores.balanceOf('kid2')).toBe(0)
    expect(chores.getDay('2026-06-10')[0].completedBy).toBe('kid1')
  })

  it('un-ticking takes the stars back from whoever claimed it', () => {
    const chore = chores.create({ title: 'Dishes', starsValue: 4, recurrence: { freq: 'daily' }, anchorDate: '2026-06-01' })
    chores.complete(chore.id, '2026-06-10', 'kid2')
    expect(chores.uncomplete(chore.id, '2026-06-10').balance).toBe(0)
    expect(chores.balanceOf('kid2')).toBe(0)
    expect(chores.getDay('2026-06-10')[0]).toMatchObject({ completed: false, completedBy: null })
  })

  it('refuses a claim by someone who is not in the family', () => {
    const chore = chores.create({ title: 'Dishes', starsValue: 4, recurrence: { freq: 'daily' }, anchorDate: '2026-06-01' })
    expect(() => chores.complete(chore.id, '2026-06-10', 'stranger')).toThrow()
    expect(chores.getDay('2026-06-10')[0].completed).toBe(false)
  })

  it('chores created when they still had an owner are now shared', () => {
    const chore = chores.create({ title: 'Feed dog', starsValue: 1, recurrence: { freq: 'daily' }, anchorDate: '2026-06-01' })
    handle.sqlite.prepare("UPDATE chores SET person_id = 'kid1' WHERE id = ?").run(chore.id)
    chores.complete(chore.id, '2026-06-10', 'kid2')
    expect(chores.balanceOf('kid2')).toBe(1)
    expect(chores.balanceOf('kid1')).toBe(0)
  })
})
