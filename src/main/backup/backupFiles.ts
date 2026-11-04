import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Backup files — no Electron imports, so this is unit-testable.
 *
 * Daily backups are `openskylight-YYYY-MM-DD.db` (a second backup the same day replaces the first);
 * the copy taken just before a restore is `before-restore-YYYY-MM-DD-HHmmss.db`.
 */

export const DAILY_RE = /^openskylight-(\d{4}-\d{2}-\d{2})\.db$/
export const BEFORE_RESTORE_RE = /^before-restore-(\d{4}-\d{2}-\d{2})-\d{6}\.db$/

const KEEP_DAILY = 14
const KEEP_MONTHLY = 12
const KEEP_BEFORE_RESTORE = 3

export function dailyName(date: string): string {
  return `openskylight-${date}.db`
}

/** Daily backups to keep: the newest 14, plus the newest of each of the last 12 months. */
export function dailyToKeep(names: string[]): Set<string> {
  const daily = names.filter((n) => DAILY_RE.test(n)).sort().reverse()
  const keep = new Set(daily.slice(0, KEEP_DAILY))
  const months = new Set<string>()
  for (const n of daily) {
    const month = DAILY_RE.exec(n)![1].slice(0, 7)
    if (months.has(month)) continue
    months.add(month)
    if (months.size > KEEP_MONTHLY) break
    keep.add(n)
  }
  return keep
}

/** Deletes old backups in `dir`; files that aren't ours are never touched. */
export function prune(dir: string): void {
  const names = readdirSync(dir)
  const keepDaily = dailyToKeep(names)
  const beforeRestore = names.filter((n) => BEFORE_RESTORE_RE.test(n)).sort().reverse()
  const keep = new Set([...keepDaily, ...beforeRestore.slice(0, KEEP_BEFORE_RESTORE)])
  for (const n of names) {
    if ((DAILY_RE.test(n) || BEFORE_RESTORE_RE.test(n)) && !keep.has(n)) rmSync(join(dir, n), { force: true })
  }
}

/** Throws unless `file` is a readable, undamaged SQLite database. */
export function assertIntact(file: string): void {
  const check = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const result = check.pragma('integrity_check', { simple: true })
    if (result !== 'ok') throw new Error(`Backup failed its check: ${String(result)}`)
  } finally {
    check.close()
  }
}

/**
 * SQLite's online backup — safe while the app is using the database (a plain file copy of a
 * WAL database can be torn). Written beside the target, checked, then moved into place.
 */
export async function writeBackup(sqlite: Database.Database, dest: string): Promise<void> {
  const tmp = `${dest}.partial`
  rmSync(tmp, { force: true })
  try {
    await sqlite.backup(tmp)
    assertIntact(tmp)
    renameSync(tmp, dest)
  } finally {
    rmSync(tmp, { force: true })
  }
}

/** Where a chosen backup waits until the next start swaps it in. */
export function pendingRestorePath(dbPath: string): string {
  return `${dbPath}.restore`
}

/**
 * Run before the database is opened: if a restore is pending, keep a copy of the current data
 * as `before-restore-…`, then move the chosen backup into place. Returns whether it restored.
 */
export function applyPendingRestore(dbPath: string, backupsDir: string, stamp: string): boolean {
  const pending = pendingRestorePath(dbPath)
  if (!existsSync(pending)) return false
  assertIntact(pending)
  if (existsSync(dbPath)) {
    mkdirSync(backupsDir, { recursive: true })
    const current = new Database(dbPath)
    try {
      current.exec(`VACUUM INTO '${join(backupsDir, `before-restore-${stamp}.db`).replace(/'/g, "''")}'`)
    } finally {
      current.close()
    }
  }
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true })
  renameSync(pending, dbPath)
  return true
}
