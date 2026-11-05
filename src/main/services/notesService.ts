import { asc, eq, inArray, isNull } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { AppDb } from '../db/client'
import { noteReplies, notes } from '../db/schema'
import { uuidv7 } from '@shared/uuid'
import { isoUtc } from '@shared/dates'
import type { NoteDto, NoteInput, NoteReplyDto } from '@shared/types'
import { invalid, notFound } from './errors'

const MAX_LENGTH = 280
/** How far back the phone's list of conversations goes (by latest message). */
const RECENT_DAYS = 2
const RECENT_MAX = 20

function cleanText(raw: string, what: string): string {
  const text = raw.trim()
  if (!text) throw invalid(`Write a ${what} first`)
  if (text.length > MAX_LENGTH) throw invalid(`Keep ${what}s under ${MAX_LENGTH} characters`)
  return text
}

/**
 * Family notes: posted from a phone, on the kiosk until marked done or (if asked) until midnight.
 * Each note carries a short conversation — replies from the tablet and from phones.
 */
export function createNotesService(db: AppDb, deviceTz: () => string, now: () => DateTime = () => DateTime.utc()) {
  function withReplies(rows: (typeof notes.$inferSelect)[]): NoteDto[] {
    const ids = rows.map((n) => n.id)
    const byNote = new Map<string, NoteReplyDto[]>()
    if (ids.length > 0) {
      const replyRows = db
        .select()
        .from(noteReplies)
        .where(inArray(noteReplies.noteId, ids))
        .orderBy(asc(noteReplies.createdAt), asc(noteReplies.id))
        .all()
      for (const r of replyRows) {
        const list = byNote.get(r.noteId) ?? []
        list.push({ id: r.id, text: r.text, authorId: r.authorId, fromKiosk: r.fromKiosk, createdAt: r.createdAt })
        byNote.set(r.noteId, list)
      }
    }
    return rows.map((n) => ({
      id: n.id,
      text: n.text,
      authorId: n.authorId,
      createdAt: n.createdAt,
      expiresAt: n.expiresAt,
      doneAt: n.doneAt,
      fromKiosk: n.fromKiosk,
      replies: byNote.get(n.id) ?? []
    }))
  }

  const isShowing = (n: typeof notes.$inferSelect, nowIso: string): boolean =>
    n.doneAt === null && (!n.expiresAt || n.expiresAt > nowIso)

  /** Notes still showing on the kiosk, oldest first (the order they're read and cleared in). */
  function list(): NoteDto[] {
    const nowIso = isoUtc(now())
    const rows = db
      .select()
      .from(notes)
      .where(isNull(notes.doneAt))
      .orderBy(asc(notes.createdAt))
      .all()
      .filter((n) => isShowing(n, nowIso))
    return withReplies(rows)
  }

  /**
   * The phone's conversations: everything still on the kiosk, plus notes that came off it in the
   * last couple of days, so a reply tapped just before "Done" is still readable. Newest activity first.
   */
  function recent(): NoteDto[] {
    const at = now()
    const nowIso = isoUtc(at)
    const since = isoUtc(at.minus({ days: RECENT_DAYS }))
    const all = withReplies(db.select().from(notes).where(inArray(notes.id, recentIds(since))).all())
    const lastActivity = (n: NoteDto): string => n.replies.at(-1)?.createdAt ?? n.createdAt
    return all
      .map((n) => ({ ...n, doneAt: n.doneAt ?? (n.expiresAt && n.expiresAt <= nowIso ? n.expiresAt : null) }))
      .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)))
      .slice(0, RECENT_MAX)
  }

  /** Ids of open notes and of notes with a message since `since`. */
  function recentIds(since: string): string[] {
    const open = db.select({ id: notes.id, createdAt: notes.createdAt, doneAt: notes.doneAt }).from(notes).all()
    const ids = new Set(open.filter((n) => n.doneAt === null || n.createdAt >= since).map((n) => n.id))
    for (const r of db.select({ noteId: noteReplies.noteId, createdAt: noteReplies.createdAt }).from(noteReplies).all()) {
      if (r.createdAt >= since) ids.add(r.noteId)
    }
    return [...ids]
  }

  function add(input: NoteInput, fromKiosk = false): NoteDto {
    const text = cleanText(input.text, 'message')
    const at = now()
    const row = {
      id: uuidv7(),
      text,
      authorId: input.authorId,
      createdAt: isoUtc(at),
      expiresAt: input.untilTonight ? isoUtc(at.setZone(deviceTz()).endOf('day')) : null,
      doneAt: null,
      fromKiosk
    }
    db.insert(notes).values(row).run()
    return { ...row, replies: [] }
  }

  /**
   * One message under a note. A reply from a phone puts a note that's done (or past "until
   * tonight") back on the kiosk, so the tablet sees it — like a new text in an old conversation.
   */
  function reply(input: { noteId: string; text: string; authorId: string | null; fromKiosk: boolean }): NoteReplyDto {
    const text = cleanText(input.text, 'reply')
    const [note] = db.select().from(notes).where(eq(notes.id, input.noteId)).all()
    if (!note) throw notFound('Chat')
    const at = now()
    const row = {
      id: uuidv7(),
      noteId: note.id,
      text,
      authorId: input.fromKiosk ? null : input.authorId,
      fromKiosk: input.fromKiosk,
      createdAt: isoUtc(at)
    }
    db.transaction((tx) => {
      tx.insert(noteReplies).values(row).run()
      if (!input.fromKiosk && !isShowing(note, row.createdAt)) {
        // back on the kiosk; an "until tonight" note gets the rest of today again
        tx.update(notes)
          .set({ doneAt: null, expiresAt: note.expiresAt ? isoUtc(at.setZone(deviceTz()).endOf('day')) : null })
          .where(eq(notes.id, note.id))
          .run()
      }
    })
    return { id: row.id, text, authorId: row.authorId, fromKiosk: row.fromKiosk, createdAt: row.createdAt }
  }

  /** Off the kiosk; kept in the table so the phone can still read the conversation for a while. */
  function done(id: string): void {
    db.update(notes).set({ doneAt: isoUtc(now()) }).where(eq(notes.id, id)).run()
  }

  return { list, recent, add, reply, done }
}

export type NotesService = ReturnType<typeof createNotesService>
