import type { BackupStatus } from './types'

/**
 * Problems worth a line in the header, so nobody has to open Settings to find out that
 * calendars stopped updating or backups stopped working. Most important first.
 */

export interface KioskIssue {
  key: string
  message: string
  /** the Settings tab that explains or fixes it */
  tab: 'calendars' | 'general'
}

export interface IssueInputs {
  google: { accounts: { email: string; error: string | null }[] } | null | undefined
  sync: { calendars: { name: string; provider: string; lastSyncedAt: string | null; syncError: string | null }[] } | null | undefined
  backup: BackupStatus | null | undefined
  nowMs: number
  /** how long the screen has been up: a fresh start hasn't had time to sync or back up yet */
  uptimeMs: number
}

/** Google calendars pull every minute; this long without one means something's wrong (Wi-Fi?). */
const SYNC_STALE_MS = 30 * 60_000
/** The first backup runs a minute after starting; past this, "never backed up" is a real problem. */
const FIRST_BACKUP_GRACE_MS = 10 * 60_000

function ago(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 90) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 36 ? `${hours} hours` : `${Math.round(hours / 24)} days`
}

export function collectIssues({ google, sync, backup, nowMs, uptimeMs }: IssueInputs): KioskIssue[] {
  const issues: KioskIssue[] = []

  const expired = (google?.accounts ?? []).filter((a) => a.error)
  for (const a of expired) {
    issues.push({ key: `signin:${a.email}`, message: `Google sign-in expired (${a.email}) — reconnect in Settings`, tab: 'calendars' })
  }

  // an expired sign-in already explains its calendars' errors
  const calendars = (sync?.calendars ?? []).filter((c) => !(expired.length > 0 && c.provider === 'google'))
  const failing = calendars.filter((c) => c.syncError)
  if (failing.length > 0) {
    const more = failing.length > 1 ? ` and ${failing.length - 1} more` : ''
    issues.push({ key: 'sync-error', message: `Couldn't update ${failing[0].name}${more}`, tab: 'calendars' })
  }

  if (expired.length === 0 && failing.length === 0 && uptimeMs > SYNC_STALE_MS) {
    const synced = (sync?.calendars ?? [])
      .filter((c) => c.provider === 'google' && c.lastSyncedAt)
      .map((c) => Date.parse(c.lastSyncedAt!))
    if (synced.length > 0) {
      const newest = Math.max(...synced)
      if (nowMs - newest > SYNC_STALE_MS) {
        issues.push({ key: 'sync-stale', message: `Calendars haven't updated for ${ago(nowMs - newest)} — check the Wi-Fi`, tab: 'calendars' })
      }
    }
  }

  if (backup) {
    if (backup.lastError) issues.push({ key: 'backup-error', message: `Backup failed — ${backup.lastError}`, tab: 'general' })
    else if (backup.folderError) issues.push({ key: 'backup-folder', message: "Backup couldn't reach its extra folder", tab: 'general' })
    else if (backup.lastAt === null ? uptimeMs > FIRST_BACKUP_GRACE_MS : backup.stale) {
      issues.push({
        key: 'backup-stale',
        message: backup.lastAt ? `No backup for ${ago(nowMs - Date.parse(backup.lastAt))}` : 'No backup has been made yet',
        tab: 'general'
      })
    }
  }

  return issues
}
