import type Database from 'better-sqlite3'
import { app, dialog } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DateTime } from 'luxon'
import type { BackupStatus } from '@shared/types'
import { isInSleepWindow } from '@shared/sleepWindow'
import type { SettingsService } from '../services/settingsService'
import { invalid } from '../services/errors'
import { BEFORE_RESTORE_RE, DAILY_RE, dailyName, pendingRestorePath, prune, writeBackup } from './backupFiles'

const KEY_LAST_AT = 'backup.lastAt'
const KEY_LAST_ERROR = 'backup.lastError'
const KEY_FOLDER = 'backup.folder'
const KEY_FOLDER_ERROR = 'backup.folderError'

const CHECK_EVERY_MS = 10 * 60_000
/** With sleep off, the nightly backup runs in this hour. */
const NIGHTLY_HOUR = 3
/** Settings warns when no backup has worked for this long. */
const STALE_DAYS = 3

/**
 * Nightly copies of the database: always in userData/backups, and also in a folder the
 * parent picks (a USB stick or network share) so a dead tablet doesn't take the data with it.
 */
export function createBackupService(deps: {
  sqlite: Database.Database
  dbPath: string
  backupsDir: string
  settings: SettingsService
  deviceTz: () => string
}) {
  const { settings } = deps
  let running: Promise<BackupStatus> | null = null

  function list(): BackupStatus['backups'] {
    if (!existsSync(deps.backupsDir)) return []
    return readdirSync(deps.backupsDir)
      .filter((n) => DAILY_RE.test(n) || BEFORE_RESTORE_RE.test(n))
      .map((name) => {
        const st = statSync(join(deps.backupsDir, name))
        return { name, takenAt: st.mtime.toISOString(), sizeKb: Math.round(st.size / 1024), beforeRestore: BEFORE_RESTORE_RE.test(name) }
      })
      .sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1))
  }

  function status(): BackupStatus {
    const lastAt = settings.getRaw(KEY_LAST_AT)
    const stale = !lastAt || DateTime.fromISO(lastAt).plus({ days: STALE_DAYS }) < DateTime.now()
    return {
      lastAt,
      lastError: settings.getRaw(KEY_LAST_ERROR),
      folder: settings.getRaw(KEY_FOLDER),
      folderError: settings.getRaw(KEY_FOLDER_ERROR),
      stale,
      backups: list()
    }
  }

  async function run(): Promise<BackupStatus> {
    const today = DateTime.now().setZone(deps.deviceTz()).toISODate()!
    const name = dailyName(today)
    try {
      mkdirSync(deps.backupsDir, { recursive: true })
      await writeBackup(deps.sqlite, join(deps.backupsDir, name))
      prune(deps.backupsDir)
      settings.setRaw(KEY_LAST_AT, new Date().toISOString())
      settings.deleteRaw(KEY_LAST_ERROR)
    } catch (err) {
      settings.setRaw(KEY_LAST_ERROR, err instanceof Error ? err.message : String(err))
      return status()
    }
    // the copy elsewhere: its failure (stick unplugged) never undoes the local backup
    const folder = settings.getRaw(KEY_FOLDER)
    if (folder) {
      try {
        copyFileSync(join(deps.backupsDir, name), join(folder, name))
        prune(folder)
        settings.deleteRaw(KEY_FOLDER_ERROR)
      } catch (err) {
        settings.setRaw(KEY_FOLDER_ERROR, `Couldn't copy to ${folder}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return status()
  }

  /** One backup at a time; a second request waits for the first. */
  function backupNow(): Promise<BackupStatus> {
    running ??= run().finally(() => (running = null))
    return running
  }

  function due(): boolean {
    const tz = deps.deviceTz()
    const now = DateTime.now().setZone(tz)
    const lastAt = settings.getRaw(KEY_LAST_AT)
    if (lastAt && DateTime.fromISO(lastAt).setZone(tz).toISODate() === now.toISODate()) return false
    const sleep = settings.getAll().sleep
    return sleep.enabled ? isInSleepWindow(now.hour * 60 + now.minute, sleep.start, sleep.end) : now.hour === NIGHTLY_HOUR
  }

  function start(): void {
    // the tablet may have been off overnight: catch up shortly after starting
    const lastAt = settings.getRaw(KEY_LAST_AT)
    if (!lastAt || DateTime.fromISO(lastAt).plus({ days: 1 }) < DateTime.now()) {
      setTimeout(() => void backupNow(), 60_000).unref()
    }
    setInterval(() => {
      if (due()) void backupNow()
    }, CHECK_EVERY_MS).unref()
  }

  async function pickFolder(): Promise<BackupStatus> {
    const result = await dialog.showOpenDialog({
      title: 'Choose a folder for backups (a USB stick or network folder)',
      properties: ['openDirectory', 'createDirectory']
    })
    if (!result.canceled && result.filePaths.length > 0) {
      settings.setRaw(KEY_FOLDER, result.filePaths[0])
      settings.deleteRaw(KEY_FOLDER_ERROR)
      return backupNow()
    }
    return status()
  }

  function clearFolder(): BackupStatus {
    settings.deleteRaw(KEY_FOLDER)
    settings.deleteRaw(KEY_FOLDER_ERROR)
    return status()
  }

  /** Queues `name` to replace the database and restarts; the swap happens before the next open. */
  function restore(name: string): void {
    if (!DAILY_RE.test(name) && !BEFORE_RESTORE_RE.test(name)) throw invalid('Unknown backup')
    const file = join(deps.backupsDir, name)
    if (!existsSync(file)) throw invalid('That backup no longer exists')
    copyFileSync(file, pendingRestorePath(deps.dbPath))
    // a portable build runs from a temp copy that is deleted on exit: relaunch the portable exe
    const portable = process.env.PORTABLE_EXECUTABLE_FILE
    app.relaunch(portable ? { execPath: portable, args: process.argv.slice(1) } : undefined)
    setTimeout(() => app.exit(0), 300)
  }

  return { status, backupNow, start, pickFolder, clearFolder, restore }
}

export type BackupService = ReturnType<typeof createBackupService>
