import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { DateTime } from 'luxon'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrations'
import { createNotesService } from '../../src/main/services/notesService'

const ZONE = 'America/Regina'
let handle: DbHandle
let clock: DateTime
beforeEach(() => {
  handle = openDatabase(':memory:')
  clock = DateTime.fromISO('2026-11-04T15:00:00', { zone: ZONE }) // 3 pm local
})
afterEach(() => handle.sqlite.close())
const notes = () => createNotesService(handle.db, () => ZONE, () => clock.toUTC())

describe('family notes', () => {
  it('posts a note and lists oldest first, with its author', () => {
    const svc = notes()
    svc.add({ text: 'Grandma pickup today', authorId: 'mum', untilTonight: false })
    clock = clock.plus({ minutes: 5 })
    svc.add({ text: '  Hockey bags in the car  ', authorId: null, untilTonight: false })
    const list = svc.list()
    expect(list.map((n) => n.text)).toEqual(['Grandma pickup today', 'Hockey bags in the car'])
    expect(list[0]).toMatchObject({ authorId: 'mum', expiresAt: null })
  })

  it('Done takes a note off; "until tonight" drops off at local midnight', () => {
    const svc = notes()
    const a = svc.add({ text: 'Done soon', authorId: null, untilTonight: false })
    const tonight = svc.add({ text: 'Practice cancelled', authorId: null, untilTonight: true })
    expect(DateTime.fromISO(tonight.expiresAt!).setZone(ZONE).toFormat('HH:mm')).toBe('23:59')
    svc.done(a.id)
    expect(svc.list().map((n) => n.text)).toEqual(['Practice cancelled'])
    clock = clock.set({ hour: 23, minute: 58 })
    expect(svc.list()).toHaveLength(1)
    clock = clock.plus({ days: 1 }).set({ hour: 0, minute: 1 })
    expect(svc.list()).toEqual([])
  })

  it('refuses empty or overlong notes', () => {
    const svc = notes()
    expect(() => svc.add({ text: '   ', authorId: null, untilTonight: false })).toThrow()
    expect(() => svc.add({ text: 'x'.repeat(281), authorId: null, untilTonight: false })).toThrow()
  })

  it('a v3 database upgrades to v4 with an empty notes table, nothing else touched', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, 3)
    sqlite.exec(`INSERT INTO people (id, name, color, role, sort_order, created_at) VALUES ('kid1','Emma','#46A758','child',0,'2026-01-01T00:00:00Z')`)
    runMigrations(sqlite)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(4)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM notes').get()).toEqual({ n: 0 })
    expect(sqlite.prepare('SELECT name FROM people').get()).toEqual({ name: 'Emma' })
    sqlite.close()
  })
})
