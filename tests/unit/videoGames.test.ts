import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../src/main/db/migrations'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { people } from '../../src/main/db/schema'
import { createChoresService } from '../../src/main/services/choresService'
import { VIDEO_GAMES_SET_ID } from '../../src/shared/types'

const DAY = '2026-11-07' // a Saturday
let handle: DbHandle
let chores: ReturnType<typeof createChoresService>

beforeEach(() => {
  handle = openDatabase(':memory:')
  for (const [id, name] of [['emma', 'Emma'], ['tom', 'Tom']]) {
    handle.db.insert(people).values({ id, name, color: '#8E4EC6', role: 'child', sortOrder: 0, createdAt: '2026-01-01T00:00:00Z' }).run()
  }
  chores = createChoresService(handle.db, () => 'America/Regina')
  chores.setVideoGamesStars(5)
})
afterEach(() => handle.sqlite.close())

/** Three Video Games tasks due on DAY for Emma and Tom, each doable `times` times a day. */
function threeTasks(times: number | null = 1) {
  return ['Clean room', 'Homework', 'Piano'].map((title) =>
    chores.create({ title, starsValue: 3, recurrence: null, anchorDate: DAY, mode: 'videogames', assignees: ['emma', 'tom'], times })
  )
}
const balance = (id: string) => chores.balanceOf(id)
const card = () => chores.checklistsDay(DAY).find((c) => c.checklistId === VIDEO_GAMES_SET_ID)!
const person = (id: string) => card().people.find((p) => p.personId === id)!

describe('Video Games chores', () => {
  it('tasks pay nothing alone and show in the set card, not the plain chore list', () => {
    const [t] = threeTasks()
    expect(t.starsValue).toBe(0)
    chores.complete(t.id, DAY, 'emma')
    expect(balance('emma')).toBe(0)
    expect(chores.getDay(DAY)).toEqual([])
    expect(card()).toMatchObject({ title: 'Video Games', kind: 'videogames', stars: 5 })
    expect(person('emma')).toMatchObject({ done: 1, total: 3, unlock: 'locked' })
  })

  it('the whole set finished → waits for a parent; approval pays the set reward', () => {
    const tasks = threeTasks()
    expect(chores.complete(tasks[0].id, DAY, 'emma').unlocked).toBeUndefined()
    chores.complete(tasks[1].id, DAY, 'emma')
    expect(chores.complete(tasks[2].id, DAY, 'emma').unlocked).toBe('Video Games')
    expect(balance('emma')).toBe(0) // not until a parent signs off
    expect(person('emma').unlock).toBe('pending')
    const [pending] = chores.pendingUnlocks(DAY)
    expect(pending).toMatchObject({ checklistId: VIDEO_GAMES_SET_ID, personId: 'emma', kind: 'videogames', round: 1, stars: 5 })
    chores.approveUnlock(VIDEO_GAMES_SET_ID, 'emma', DAY, 1)
    expect(balance('emma')).toBe(5)
    expect(person('emma')).toMatchObject({ unlock: 'approved', rounds: 1 })
    expect(chores.pendingUnlocks(DAY)).toEqual([])
    // Tom is on his own: nothing for him yet
    expect(person('tom')).toMatchObject({ done: 0, unlock: 'locked' })
  })

  it('repeatable tasks: every full set again is another round, another reward', () => {
    const tasks = threeTasks(2)
    for (const t of tasks) chores.complete(t.id, DAY, 'emma')
    chores.approveUnlock(VIDEO_GAMES_SET_ID, 'emma', DAY, 1)
    // the ticks start over for round 2
    expect(person('emma')).toMatchObject({ done: 0, total: 3, unlock: 'locked', rounds: 1 })
    chores.complete(tasks[0].id, DAY, 'emma')
    chores.complete(tasks[1].id, DAY, 'emma')
    expect(chores.pendingUnlocks(DAY)).toEqual([])
    expect(chores.complete(tasks[2].id, DAY, 'emma').unlocked).toBe('Video Games')
    expect(chores.pendingUnlocks(DAY).map((p) => p.round)).toEqual([2])
    chores.approveUnlock(VIDEO_GAMES_SET_ID, 'emma', DAY, 2)
    expect(balance('emma')).toBe(10)
    // twice a day was the limit: the set stays done
    chores.complete(tasks[0].id, DAY, 'emma')
    expect(person('emma')).toMatchObject({ done: 3, unlock: 'approved', rounds: 2 })
    expect(balance('emma')).toBe(10)
  })

  it('un-ticking after the fact takes the round (and its controllers) back', () => {
    const tasks = threeTasks()
    for (const t of tasks) chores.complete(t.id, DAY, 'emma')
    chores.approveUnlock(VIDEO_GAMES_SET_ID, 'emma', DAY, 1)
    expect(balance('emma')).toBe(5)
    chores.uncomplete(tasks[1].id, DAY, 'emma')
    expect(balance('emma')).toBe(0)
    expect(person('emma')).toMatchObject({ done: 2, unlock: 'locked', rounds: 0 })
    // finishing it again asks for a fresh sign-off
    expect(chores.complete(tasks[1].id, DAY, 'emma').unlocked).toBe('Video Games')
    expect(chores.pendingUnlocks(DAY)).toHaveLength(1)
  })

  it('the reward is a setting; a round keeps the amount it was finished at', () => {
    expect(chores.videoGamesStars()).toEqual({ stars: 5 })
    const tasks = threeTasks()
    for (const t of tasks) chores.complete(t.id, DAY, 'tom')
    chores.setVideoGamesStars(8)
    chores.approveUnlock(VIDEO_GAMES_SET_ID, 'tom', DAY, 1)
    expect(balance('tom')).toBe(5)
    expect(card().stars).toBe(8)
  })

  it('only due tasks count: a Video Games task for another day is not part of the set', () => {
    const tasks = threeTasks()
    chores.create({ title: 'Sunday only', starsValue: 0, recurrence: null, anchorDate: '2026-11-08', mode: 'videogames', assignees: ['emma'] })
    for (const t of tasks) chores.complete(t.id, DAY, 'emma')
    expect(chores.pendingUnlocks(DAY)).toHaveLength(1)
    expect(person('emma').total).toBe(3)
  })
})

describe('database upgrade for Video Games (v4 to v5)', () => {
  it('adds an empty rounds table and keeps existing chores', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, 4)
    sqlite.exec(`INSERT INTO chores (id, title, stars_value, created_at) VALUES ('c1','Dishes',2,'2026-06-01T00:00:00Z')`)
    runMigrations(sqlite)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(5)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM video_game_rounds').get()).toEqual({ n: 0 })
    expect(sqlite.prepare('SELECT title, mode FROM chores').get()).toEqual({ title: 'Dishes', mode: 'anyone' })
    sqlite.close()
  })
})

describe('Video Games reward default', () => {
  it('is 60 until a parent changes it', () => {
    const h = openDatabase(':memory:')
    expect(createChoresService(h.db, () => 'America/Regina').videoGamesStars()).toEqual({ stars: 60 })
    h.sqlite.close()
  })
})
