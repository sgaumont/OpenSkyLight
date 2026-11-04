import { asc, eq, isNull } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { AppDb } from '../db/client'
import { notes } from '../db/schema'
import { uuidv7 } from '@shared/uuid'
import { isoUtc } from '@shared/dates'
import type { NoteDto, NoteInput } from '@shared/types'
import { invalid } from './errors'

const MAX_LENGTH = 280

/** Family notes: posted from a phone, on the kiosk until marked done or (if asked) until midnight. */
export function createNotesService(db: AppDb, deviceTz: () => string, now: () => DateTime = () => DateTime.utc()) {
  /** Notes still showing, oldest first (the order they're read and cleared in). */
  function list(): NoteDto[] {
    const nowIso = isoUtc(now())
    return db
      .select()
      .from(notes)
      .where(isNull(notes.doneAt))
      .orderBy(asc(notes.createdAt))
      .all()
      .filter((n) => !n.expiresAt || n.expiresAt > nowIso)
      .map((n) => ({ id: n.id, text: n.text, authorId: n.authorId, createdAt: n.createdAt, expiresAt: n.expiresAt }))
  }

  function add(input: NoteInput): NoteDto {
    const text = input.text.trim()
    if (!text) throw invalid('Write a note first')
    if (text.length > MAX_LENGTH) throw invalid(`Keep notes under ${MAX_LENGTH} characters`)
    const at = now()
    const row = {
      id: uuidv7(),
      text,
      authorId: input.authorId,
      createdAt: isoUtc(at),
      expiresAt: input.untilTonight ? isoUtc(at.setZone(deviceTz()).endOf('day')) : null,
      doneAt: null
    }
    db.insert(notes).values(row).run()
    return { id: row.id, text, authorId: row.authorId, createdAt: row.createdAt, expiresAt: row.expiresAt }
  }

  /** Off the kiosk; kept in the table (nothing reads done notes, they're tiny). */
  function done(id: string): void {
    db.update(notes).set({ doneAt: isoUtc(now()) }).where(eq(notes.id, id)).run()
  }

  return { list, add, done }
}

export type NotesService = ReturnType<typeof createNotesService>
