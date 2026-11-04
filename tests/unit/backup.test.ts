import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyPendingRestore,
  dailyName,
  dailyToKeep,
  pendingRestorePath,
  prune,
  writeBackup
} from '../../src/main/backup/backupFiles'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'osl-backup-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function makeDb(file: string, note: string): Database.Database {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE IF NOT EXISTS notes (text TEXT)')
  db.prepare('INSERT INTO notes VALUES (?)').run(note)
  return db
}
const notes = (file: string): string[] => {
  const db = new Database(file, { readonly: true })
  const rows = db.prepare('SELECT text FROM notes').all() as { text: string }[]
  db.close()
  return rows.map((r) => r.text)
}

describe('backup retention', () => {
  it('keeps the newest 14 days plus the newest of each of the last 12 months', () => {
    const names: string[] = []
    // every day from 2025-06-01 to 2026-11-04
    for (let d = new Date(Date.UTC(2025, 5, 1)); d <= new Date(Date.UTC(2026, 10, 4)); d.setUTCDate(d.getUTCDate() + 1)) {
      names.push(dailyName(d.toISOString().slice(0, 10)))
    }
    const keep = dailyToKeep([...names, 'notes.txt'])
    expect(keep.has(dailyName('2026-11-04'))).toBe(true)
    expect(keep.has(dailyName('2026-10-22'))).toBe(true) // 14th newest
    expect(keep.has(dailyName('2026-10-21'))).toBe(false)
    expect(keep.has(dailyName('2026-09-30'))).toBe(true) // end of September
    expect(keep.has(dailyName('2025-12-31'))).toBe(true) // 12th month back
    expect(keep.has(dailyName('2025-11-30'))).toBe(false) // 13th month back
    expect(keep.size).toBe(14 + 10) // November's and October's newest are already among the 14
  })

  it('prune deletes only old backups, never other files', () => {
    for (let i = 1; i <= 20; i++) writeFileSync(join(dir, dailyName(`2026-10-${String(i).padStart(2, '0')}`)), '')
    for (let i = 1; i <= 5; i++) writeFileSync(join(dir, `before-restore-2026-10-0${i}-120000.db`), '')
    writeFileSync(join(dir, 'family-photo.jpg'), '')
    prune(dir)
    const left = readdirSync(dir)
    expect(left.filter((n) => n.startsWith('openskylight-'))).toHaveLength(14)
    expect(left.filter((n) => n.startsWith('before-restore-'))).toEqual([
      'before-restore-2026-10-03-120000.db',
      'before-restore-2026-10-04-120000.db',
      'before-restore-2026-10-05-120000.db'
    ])
    expect(left).toContain('family-photo.jpg')
  })
})

describe('backup and restore', () => {
  it('a live backup of an open WAL database is a complete, readable copy', async () => {
    const live = makeDb(join(dir, 'app.db'), 'chore: feed cat')
    const dest = join(dir, dailyName('2026-11-04'))
    await writeBackup(live, dest)
    live.close()
    expect(notes(dest)).toEqual(['chore: feed cat'])
    expect(existsSync(`${dest}.partial`)).toBe(false)
  })

  it('a pending restore saves the current data first, then swaps the backup in', async () => {
    const dbPath = join(dir, 'app.db')
    const backupsDir = join(dir, 'backups')
    const live = makeDb(dbPath, 'old')
    await writeBackup(live, pendingRestorePath(dbPath))
    live.prepare('INSERT INTO notes VALUES (?)').run('added after the backup')
    live.close()

    expect(applyPendingRestore(dbPath, backupsDir, '2026-11-04-090000')).toBe(true)
    expect(notes(dbPath)).toEqual(['old'])
    expect(notes(join(backupsDir, 'before-restore-2026-11-04-090000.db'))).toEqual(['old', 'added after the backup'])
    expect(existsSync(pendingRestorePath(dbPath))).toBe(false)
    expect(applyPendingRestore(dbPath, backupsDir, 'x')).toBe(false)
  })

  it('a damaged backup is refused and the current data is left alone', () => {
    const dbPath = join(dir, 'app.db')
    makeDb(dbPath, 'keep me').close()
    writeFileSync(pendingRestorePath(dbPath), 'not a database')
    expect(() => applyPendingRestore(dbPath, join(dir, 'backups'), 'x')).toThrow()
    expect(notes(dbPath)).toEqual(['keep me'])
  })
})
