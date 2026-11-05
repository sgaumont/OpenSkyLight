import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { DateTime } from 'luxon'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrations'
import { createNotesService } from '../../src/main/services/notesService'
import { popsUp, waiting } from '../../src/shared/chat'
import { COMPANION_CHANNELS } from '../../src/shared/ipc/companionChannels'

describe('Chat (was Notes): chats the tablet starts', () => {
  let handle: DbHandle
  let now = DateTime.fromISO('2026-11-05T20:00:00Z')
  beforeEach(() => {
    handle = openDatabase(':memory:')
    now = DateTime.fromISO('2026-11-05T20:00:00Z')
  })
  afterEach(() => handle.sqlite.close())
  const svc = () => createNotesService(handle.db, () => 'America/Edmonton', () => now)

  it('a phone chat pops up on the tablet and waits for an answer', () => {
    const notes = svc()
    notes.add({ text: 'Pick up milk', authorId: null, untilTonight: false })
    const [n] = notes.list()
    expect(n.fromKiosk).toBe(false)
    expect(popsUp(n)).toBe(true)
    expect(waiting(n)).toBe(true)
    notes.reply({ noteId: n.id, text: '👍', authorId: null, fromKiosk: true })
    expect(waiting(notes.list()[0])).toBe(false)
  })

  it("a tablet chat doesn't pop up on the tablet until a phone answers it", () => {
    const notes = svc()
    const started = notes.add({ text: "Dinner's ready", authorId: null, untilTonight: false }, true)
    expect(started.fromKiosk).toBe(true)
    let [n] = notes.list()
    expect(popsUp(n)).toBe(false)
    expect(waiting(n)).toBe(false)
    // the phones see it, from the tablet
    expect(notes.recent()[0]).toMatchObject({ text: "Dinner's ready", fromKiosk: true })
    now = now.plus({ minutes: 2 })
    notes.reply({ noteId: n.id, text: 'On my way', authorId: null, fromKiosk: false })
    ;[n] = notes.list()
    expect(popsUp(n)).toBe(true)
    expect(waiting(n)).toBe(true)
  })

  it('phones cannot start a chat as the tablet', () => {
    expect(COMPANION_CHANNELS).not.toContain('notes:kioskAdd')
  })

  it('a v9 database upgrades to v10: existing notes came from phones', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite, 9)
    sqlite.exec(`INSERT INTO notes (id, text, created_at) VALUES ('n1','Hi','2026-11-01T00:00:00Z')`)
    runMigrations(sqlite, 10)
    expect(sqlite.pragma('user_version', { simple: true })).toBe(10)
    expect(sqlite.prepare('SELECT from_kiosk AS k FROM notes').get()).toEqual({ k: 0 })
    sqlite.close()
  })
})
