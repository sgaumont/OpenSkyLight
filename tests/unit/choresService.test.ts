import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrations'
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
    // a request costs nothing until a parent grants it
    const asked = rewards.redeem(reward.id, 'kid1')
    expect(chores.balanceOf('kid1')).toBe(20)
    rewards.grant(asked.id)
    expect(chores.balanceOf('kid1')).toBe(5)
  })

  it('a parent can adjust a balance up or down, even below zero', () => {
    expect(rewards.adjust('kid1', 12)).toEqual({ balance: 12 })
    expect(rewards.adjust('kid1', -5)).toEqual({ balance: 7 })
    expect(rewards.adjust('kid1', -10)).toEqual({ balance: -3 })
    expect(rewards.adjust('kid1', 0)).toEqual({ balance: -3 })
    expect(chores.balanceOf('kid1')).toBe(-3)
    expect(chores.balanceOf('kid2')).toBe(0)
    expect(() => rewards.adjust('nobody', 3)).toThrow()
  })

  it('purging old completions keeps every star and the ledger', () => {
    const chore = chores.create({ title: 'Dishes', starsValue: 4, recurrence: { freq: 'daily' } })
    for (const d of ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11']) chores.complete(chore.id, d, 'kid1')
    rewards.adjust('kid1', -1)
    const ledger = () => handle.sqlite.prepare('SELECT COUNT(*) AS n FROM star_ledger').get() as { n: number }
    expect(ledger().n).toBe(5)

    expect(chores.purgeCompletionsBefore('2026-06-10')).toBe(2)
    expect(chores.balanceOf('kid1')).toBe(15)
    expect(ledger().n).toBe(5)
    const kept = handle.sqlite.prepare('SELECT due_date FROM chore_completions ORDER BY due_date').all()
    expect(kept).toEqual([{ due_date: '2026-06-10' }, { due_date: '2026-06-11' }])
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

  describe('chores everyone has to do', () => {
    it('each assignee ticks it separately and earns their own stars', () => {
      const chore = chores.create({
        title: 'Make bed',
        starsValue: 2,
        recurrence: { freq: 'daily' },
        anchorDate: '2026-06-01',
        mode: 'each',
        assignees: ['kid1', 'kid2']
      })
      expect(chores.getDay('2026-06-10')[0]).toMatchObject({ mode: 'each', assignees: ['kid1', 'kid2'], doneBy: [], completed: false })
      expect(chores.complete(chore.id, '2026-06-10', 'kid1').balance).toBe(2)
      expect(chores.getDay('2026-06-10')[0]).toMatchObject({ doneBy: ['kid1'], completed: false })
      expect(chores.complete(chore.id, '2026-06-10', 'kid2').balance).toBe(2)
      expect(chores.complete(chore.id, '2026-06-10', 'kid2').balance).toBe(2) // idempotent per person
      expect(chores.getDay('2026-06-10')[0]).toMatchObject({ doneBy: ['kid1', 'kid2'], completed: true })
      expect(chores.uncomplete(chore.id, '2026-06-10', 'kid1').balance).toBe(0)
      expect(chores.balanceOf('kid2')).toBe(2) // only kid1's tick was removed
      expect(chores.getDay('2026-06-10')[0].doneBy).toEqual(['kid2'])
    })

    it("refuses a tick from someone who isn't on the chore, and an un-tick that doesn't say whose", () => {
      const chore = chores.create({
        title: 'Read',
        starsValue: 1,
        recurrence: { freq: 'daily' },
        anchorDate: '2026-06-01',
        mode: 'each',
        assignees: ['kid1']
      })
      expect(() => chores.complete(chore.id, '2026-06-10', 'kid2')).toThrow(/isn't on this chore/)
      chores.complete(chore.id, '2026-06-10', 'kid1')
      expect(() => chores.uncomplete(chore.id, '2026-06-10')).toThrow()
    })

    it('needs at least one person', () => {
      expect(() => chores.create({ title: 'Read', starsValue: 1, mode: 'each', assignees: [] })).toThrow(/Pick who/)
    })

    it('a removed family member drops off the chore', () => {
      chores.create({
        title: 'Read',
        starsValue: 1,
        recurrence: { freq: 'daily' },
        anchorDate: '2026-06-01',
        mode: 'each',
        assignees: ['kid1', 'kid2']
      })
      handle.sqlite.prepare("UPDATE people SET deleted_at = '2026-06-05T00:00:00Z' WHERE id = 'kid2'").run()
      expect(chores.getDay('2026-06-10')[0].assignees).toEqual(['kid1'])
    })
  })

  describe('checklists', () => {
    // 2026-06-13 is a Saturday; byWeekdays 5 = Sat, 6 = Sun
    const weekend = { freq: 'weekly' as const, byWeekdays: [5, 6] }
    const make = () =>
      chores.createChecklist({
        title: 'Video game time',
        assignees: ['kid1', 'kid2'],
        recurrence: weekend,
        anchorDate: '2026-06-01',
        items: [{ title: 'Go outside' }, { title: 'Read for 15' }, { title: 'Something artistic' }]
      })

    it('shows on its days only, with per-person progress, and its items stay out of the chore list', () => {
      const list = make()
      expect(list.items.map((i) => i.title)).toEqual(['Go outside', 'Read for 15', 'Something artistic'])
      expect(chores.checklistsDay('2026-06-12')).toHaveLength(0) // Friday
      const [sat] = chores.checklistsDay('2026-06-13')
      expect(sat.people).toEqual([
        { personId: 'kid1', done: 0, total: 3, unlock: 'locked' },
        { personId: 'kid2', done: 0, total: 3, unlock: 'locked' }
      ])
      expect(chores.getDay('2026-06-13')).toHaveLength(0)
      expect(chores.list()).toHaveLength(0)
    })

    it('finishing every item unlocks it pending a parent, who signs off', () => {
      const list = make()
      const [a, b, c] = list.items
      chores.complete(a.id, '2026-06-13', 'kid1')
      expect(chores.complete(b.id, '2026-06-13', 'kid1').unlocked).toBeUndefined()
      expect(chores.complete(c.id, '2026-06-13', 'kid1').unlocked).toBe('Video game time')
      expect(chores.balanceOf('kid1')).toBe(0) // items earn no stars: the prize is the unlock
      expect(chores.checklistsDay('2026-06-13')[0].people[0]).toMatchObject({ done: 3, unlock: 'pending' })
      expect(chores.checklistsDay('2026-06-13')[0].people[1]).toMatchObject({ done: 0, unlock: 'locked' })
      expect(chores.pendingUnlocks('2026-06-13')).toEqual([
        { checklistId: list.id, title: 'Video game time', personId: 'kid1', date: '2026-06-13', kind: 'checklist' }
      ])
      chores.approveUnlock(list.id, 'kid1', '2026-06-13')
      expect(chores.pendingUnlocks('2026-06-13')).toHaveLength(0)
      expect(chores.checklistsDay('2026-06-13')[0].people[0].unlock).toBe('approved')
      expect(() => chores.approveUnlock(list.id, 'kid1', '2026-06-13')).toThrow() // nothing left to approve
    })

    it('resets every day: Sunday starts locked again', () => {
      const list = make()
      for (const item of list.items) chores.complete(item.id, '2026-06-13', 'kid1')
      chores.approveUnlock(list.id, 'kid1', '2026-06-13')
      expect(chores.checklistsDay('2026-06-14')[0].people[0]).toMatchObject({ done: 0, unlock: 'locked' })
    })

    it('un-ticking an item takes the unlock back, even after sign-off', () => {
      const list = make()
      for (const item of list.items) chores.complete(item.id, '2026-06-13', 'kid1')
      chores.approveUnlock(list.id, 'kid1', '2026-06-13')
      chores.uncomplete(list.items[1].id, '2026-06-13', 'kid1')
      expect(chores.checklistsDay('2026-06-13')[0].people[0]).toMatchObject({ done: 2, unlock: 'locked' })
    })

    it('editing keeps ticks on kept items, adds and removes items', () => {
      const list = make()
      chores.complete(list.items[0].id, '2026-06-13', 'kid1')
      const edited = chores.updateChecklist({
        id: list.id,
        title: 'Screen time',
        assignees: ['kid1'],
        recurrence: weekend,
        items: [{ id: list.items[0].id, title: 'Play outside' }, { title: 'Tidy up' }]
      })
      expect(edited.items.map((i) => i.title)).toEqual(['Play outside', 'Tidy up'])
      const [sat] = chores.checklistsDay('2026-06-13')
      expect(sat.title).toBe('Screen time')
      expect(sat.people).toEqual([{ personId: 'kid1', done: 1, total: 2, unlock: 'locked' }])
    })

    it('deleting a checklist removes it and its items', () => {
      const list = make()
      chores.removeChecklist(list.id)
      expect(chores.checklists()).toHaveLength(0)
      expect(chores.checklistsDay('2026-06-13')).toHaveLength(0)
    })
  })

  describe('chores done more than once a day', () => {
    // 2026-06-13 is a Saturday (rrule weekday 5)
    const SAT = '2026-06-13'
    const weekly = (extra: Partial<Parameters<ChoresService['create']>[0]> = {}) =>
      chores.create({
        title: 'Load of laundry',
        starsValue: 2,
        recurrence: { freq: 'weekly', byWeekdays: [5] },
        anchorDate: '2026-06-01',
        ...extra
      })

    it('new chores can be done once, as before', () => {
      const c = weekly()
      expect(c.times).toBe(1)
      chores.complete(c.id, SAT, 'kid1')
      chores.complete(c.id, SAT, 'kid2')
      const [day] = chores.getDay(SAT)
      expect(day.claims).toEqual(['kid1'])
      expect(day.completed).toBe(true)
      expect(chores.balances()).toEqual([{ personId: 'kid1', balance: 2 }])
    })

    it("'anyone' with times 3: any mix of people, stars to each, then full", () => {
      const c = weekly({ times: 3 })
      chores.complete(c.id, SAT, 'kid1')
      let [day] = chores.getDay(SAT)
      expect(day).toMatchObject({ times: 3, claims: ['kid1'], completed: false, completedBy: 'kid1' })
      chores.complete(c.id, SAT, 'kid1')
      chores.complete(c.id, SAT, 'kid2')
      chores.complete(c.id, SAT, 'kid2') // a 4th is refused
      ;[day] = chores.getDay(SAT)
      expect(day.claims).toEqual(['kid1', 'kid1', 'kid2'])
      expect(day.completed).toBe(true)
      const bal = Object.fromEntries(chores.balances().map((b) => [b.personId, b.balance]))
      expect(bal).toEqual({ kid1: 4, kid2: 2 })
    })

    it('starts again at zero on the next day it is due', () => {
      const c = weekly({ times: 2 })
      chores.complete(c.id, SAT, 'kid1')
      chores.complete(c.id, SAT, 'kid1')
      const [next] = chores.getDay('2026-06-20')
      expect(next).toMatchObject({ claims: [], completed: false })
    })

    it('no limit: done after the first, but more keep counting', () => {
      const c = weekly({ times: null })
      expect(c.times).toBeNull()
      for (let i = 0; i < 5; i++) chores.complete(c.id, SAT, i % 2 ? 'kid2' : 'kid1')
      const [day] = chores.getDay(SAT)
      expect(day.times).toBeNull()
      expect(day.claims).toHaveLength(5)
      expect(day.completed).toBe(true)
    })

    it('undo takes back the newest tick and its stars', () => {
      const c = weekly({ times: 3 })
      chores.complete(c.id, SAT, 'kid1')
      chores.complete(c.id, SAT, 'kid2')
      chores.uncomplete(c.id, SAT)
      const [day] = chores.getDay(SAT)
      expect(day.claims).toEqual(['kid1'])
      expect(chores.balances().find((b) => b.personId === 'kid2')?.balance ?? 0).toBe(0)
    })

    it("'each' with times 2: everyone's own count; undo is per person", () => {
      const c = weekly({ times: 2, mode: 'each', assignees: ['kid1', 'kid2'] })
      chores.complete(c.id, SAT, 'kid1')
      chores.complete(c.id, SAT, 'kid1')
      chores.complete(c.id, SAT, 'kid1') // past their 2: refused
      chores.complete(c.id, SAT, 'kid2')
      let [day] = chores.getDay(SAT)
      expect(day.claims.filter((p) => p === 'kid1')).toHaveLength(2)
      expect(day.doneBy).toEqual(['kid1'])
      expect(day.completed).toBe(false)
      chores.uncomplete(c.id, SAT, 'kid1')
      ;[day] = chores.getDay(SAT)
      expect(day.claims).toEqual(['kid1', 'kid2'])
      expect(day.doneBy).toEqual([])
    })

    it('times can be changed and cleared to no limit', () => {
      const c = weekly()
      expect(chores.update({ id: c.id, times: 4 }).times).toBe(4)
      expect(chores.update({ id: c.id, times: null }).times).toBeNull()
      expect(chores.update({ id: c.id, times: 1 }).times).toBe(1)
    })
  })
})

describe('database upgrade to per-person completions (v1 to v2)', () => {
  it('keeps existing chores, completions and stars; old chores become shared', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    runMigrations(sqlite, 1)
    sqlite.exec(`
      INSERT INTO people (id, name, color, role, sort_order, created_at) VALUES ('kid1','Emma','#46A758','child',0,'2026-01-01T00:00:00Z');
      INSERT INTO chores (id, title, person_id, stars_value, schedule_rrule, due_date, created_at)
        VALUES ('c1','Dishes','kid1',3,'FREQ=DAILY','2026-06-01','2026-06-01T00:00:00Z');
      INSERT INTO chore_completions (id, chore_id, person_id, due_date, completed_at, stars_awarded)
        VALUES ('done1','c1','kid1','2026-06-10','2026-06-10T12:00:00Z',3);
      INSERT INTO star_ledger (id, person_id, delta, reason, ref_id, created_at)
        VALUES ('s1','kid1',3,'chore','done1','2026-06-10T12:00:00Z');
    `)
    runMigrations(sqlite, 2)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(2)
    expect(sqlite.prepare('SELECT id, person_id FROM chore_completions').all()).toEqual([{ id: 'done1', person_id: 'kid1' }])
    expect(sqlite.prepare('SELECT mode FROM chores').get()).toEqual({ mode: 'anyone' })
    expect(sqlite.prepare('SELECT SUM(delta) AS s FROM star_ledger').get()).toEqual({ s: 3 })
    // two people may now each complete the same chore on the same day, but not twice
    sqlite.exec(`
      INSERT INTO people (id, name, color, role, sort_order, created_at) VALUES ('kid2','Noah','#0091FF','child',1,'2026-01-01T00:00:00Z');
      INSERT INTO chore_completions (id, chore_id, person_id, due_date, completed_at) VALUES ('done2','c1','kid2','2026-06-10','x');
    `)
    expect(() =>
      sqlite.exec(`INSERT INTO chore_completions (id, chore_id, person_id, due_date, completed_at) VALUES ('dup','c1','kid2','2026-06-10','x')`)
    ).toThrow(/UNIQUE/)
    sqlite.close()
  })
})

describe('database upgrade to chores done more than once a day (v2 to v3)', () => {
  it('keeps completions and stars, makes every chore once-a-day, and allows repeat ticks', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    runMigrations(sqlite, 2)
    sqlite.exec(`
      INSERT INTO people (id, name, color, role, sort_order, created_at) VALUES ('kid1','Emma','#46A758','child',0,'2026-01-01T00:00:00Z');
      INSERT INTO chores (id, title, stars_value, schedule_rrule, due_date, created_at)
        VALUES ('c1','Dishes',3,'FREQ=DAILY','2026-06-01','2026-06-01T00:00:00Z');
      INSERT INTO chore_completions (id, chore_id, person_id, due_date, completed_at, stars_awarded)
        VALUES ('done1','c1','kid1','2026-06-10','2026-06-10T12:00:00Z',3);
      INSERT INTO star_ledger (id, person_id, delta, reason, ref_id, created_at)
        VALUES ('s1','kid1',3,'chore','done1','2026-06-10T12:00:00Z');
    `)
    runMigrations(sqlite, 3)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(3)
    expect(sqlite.prepare('SELECT times FROM chores').get()).toEqual({ times: 1 })
    expect(sqlite.prepare('SELECT id, person_id, stars_awarded FROM chore_completions').all()).toEqual([
      { id: 'done1', person_id: 'kid1', stars_awarded: 3 }
    ])
    expect(sqlite.prepare('SELECT SUM(delta) AS s FROM star_ledger').get()).toEqual({ s: 3 })
    sqlite.exec(`INSERT INTO chore_completions (id, chore_id, person_id, due_date, completed_at) VALUES ('again','c1','kid1','2026-06-10','x')`)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM chore_completions').get()).toEqual({ n: 2 })
    sqlite.close()
  })
})
