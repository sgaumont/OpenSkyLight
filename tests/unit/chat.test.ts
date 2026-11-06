import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { DateTime } from 'luxon'
import { openDatabase, type DbHandle } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrations'
import { createNotesService } from '../../src/main/services/notesService'
import { COMPANION_CHANNELS } from '../../src/shared/ipc/companionChannels'

describe('Chat: one family conversation', () => {
  let handle: DbHandle
  let now = DateTime.fromISO('2026-11-05T20:00:00Z')
  beforeEach(() => {
    handle = openDatabase(':memory:')
    now = DateTime.fromISO('2026-11-05T20:00:00Z')
  })
  afterEach(() => handle.sqlite.close())
  const svc = () => createNotesService(handle.db, () => 'America/Edmonton', () => now)
  const later = (min: number) => {
    now = now.plus({ minutes: min })
  }

  it('every message, tablet and phones, lands in one stream, oldest first', () => {
    const chat = svc()
    chat.send({ text: 'Pick up milk', authorId: 'mom' }, false)
    later(1)
    chat.send({ text: 'On my way', authorId: null }, true)
    later(1)
    chat.send({ text: 'Thanks!', authorId: 'mom' }, false)
    const t = chat.timeline()
    expect(t.map((m) => [m.text, m.fromKiosk])).toEqual([
      ['Pick up milk', false],
      ['On my way', true],
      ['Thanks!', false]
    ])
    expect(t[1].authorId).toBeNull() // the tablet never has a person
  })

  it('a phone message is unseen (pops up and chimes) until the tablet answers', () => {
    const chat = svc()
    chat.send({ text: 'Running late', authorId: null }, false)
    later(1)
    chat.send({ text: 'Start dinner', authorId: null }, false)
    expect(chat.timeline().filter((m) => m.unseen).map((m) => m.text)).toEqual(['Running late', 'Start dinner'])
    later(1)
    chat.send({ text: '👍', authorId: null }, true)
    expect(chat.timeline().some((m) => m.unseen)).toBe(false)
    // the phone has the last word again → unseen again
    later(1)
    chat.send({ text: 'Also bread', authorId: null }, false)
    expect(chat.timeline().filter((m) => m.unseen).map((m) => m.text)).toEqual(['Also bread'])
  })

  it('✓ Seen clears them without an answer; tablet messages are never unseen', () => {
    const chat = svc()
    chat.send({ text: "Dinner's ready", authorId: null }, true)
    expect(chat.timeline()[0].unseen).toBe(false)
    chat.send({ text: 'Coming', authorId: null }, false)
    chat.seen()
    expect(chat.timeline().some((m) => m.unseen)).toBe(false)
  })

  it('the old separate chats fold into the stream in time order (first message, then replies)', () => {
    const chat = svc()
    const n = chat.add({ text: 'Old note', authorId: null, untilTonight: false })
    later(5)
    chat.reply({ noteId: n.id, text: 'Old reply', authorId: null, fromKiosk: true })
    later(5)
    chat.send({ text: 'New message', authorId: null }, false)
    expect(chat.timeline().map((m) => m.text)).toEqual(['Old note', 'Old reply', 'New message'])
  })

  it('phones can read and send, but never as the tablet', () => {
    expect(COMPANION_CHANNELS).toContain('chat:timeline')
    expect(COMPANION_CHANNELS).toContain('chat:send')
    expect(COMPANION_CHANNELS).not.toContain('chat:kioskSend')
    expect(COMPANION_CHANNELS).not.toContain('chat:seen')
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
