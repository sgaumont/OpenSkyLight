import { describe, expect, it } from 'vitest'
import { collectIssues, type IssueInputs } from '../../src/shared/kioskIssues'
import { isSignInRefused } from '../../src/main/sync/googleSync'

const now = Date.parse('2026-11-04T18:00:00Z')
const min = 60_000
const cal = (name: string, provider: string, syncedMinAgo: number | null, syncError: string | null = null) => ({
  name,
  provider,
  lastSyncedAt: syncedMinAgo === null ? null : new Date(now - syncedMinAgo * min).toISOString(),
  syncError
})
const okBackup = { lastAt: new Date(now - 5 * 60 * min).toISOString(), lastError: null, folder: null, folderError: null, stale: false, backups: [] }
const base: IssueInputs = {
  google: { accounts: [{ email: 'a@x.com', error: null }] },
  sync: { calendars: [cal('SW404', 'google', 1), cal('School', 'ics', 50)] },
  backup: okBackup,
  nowMs: now,
  uptimeMs: 60 * min
}

describe('header issue line', () => {
  it('nothing to say when everything is fine', () => {
    expect(collectIssues(base)).toEqual([])
  })

  it('an expired sign-in comes first and stands in for its calendars’ errors', () => {
    const issues = collectIssues({
      ...base,
      google: { accounts: [{ email: 'a@x.com', error: 'Sign-in expired — reconnect this account' }] },
      sync: { calendars: [cal('SW404', 'google', 90, '401'), cal('SW301', 'google', 90, '401')] }
    })
    expect(issues.map((i) => [i.key, i.tab])).toEqual([['signin:a@x.com', 'calendars']])
    expect(issues[0].message).toContain('reconnect')
  })

  it('a failing calendar is named, with a count of the rest', () => {
    const issues = collectIssues({ ...base, sync: { calendars: [cal('SW404', 'google', 1, 'boom'), cal('School', 'ics', 5, 'HTTP 500')] } })
    expect(issues.map((i) => i.message)).toEqual(["Couldn't update SW404 and 1 more"])
  })

  it('calendars not updating for half an hour: probably the Wi-Fi', () => {
    const stale = { ...base, sync: { calendars: [cal('SW404', 'google', 45)] } }
    expect(collectIssues(stale).map((i) => i.message)).toEqual(["Calendars haven't updated for 45 min — check the Wi-Fi"])
    // not right after starting up, before the first sync has had a chance
    expect(collectIssues({ ...stale, uptimeMs: 2 * min })).toEqual([])
  })

  it('backup problems, in order of seriousness; a fresh install gets a grace period', () => {
    expect(collectIssues({ ...base, backup: { ...okBackup, lastError: 'disk full' } })[0].message).toBe('Backup failed — disk full')
    expect(collectIssues({ ...base, backup: { ...okBackup, folderError: 'unplugged' } })[0].key).toBe('backup-folder')
    const old = { ...okBackup, lastAt: new Date(now - 4 * 24 * 60 * min).toISOString(), stale: true }
    expect(collectIssues({ ...base, backup: old })[0].message).toBe('No backup for 4 days')
    const never = { ...okBackup, lastAt: null, stale: true }
    expect(collectIssues({ ...base, backup: never, uptimeMs: 2 * min })).toEqual([])
    expect(collectIssues({ ...base, backup: never })[0].message).toBe('No backup has been made yet')
  })
})

describe('isSignInRefused', () => {
  it('a 401 or an invalid_grant refresh, not other failures', () => {
    expect(isSignInRefused({ status: 401 })).toBe(true)
    expect(isSignInRefused({ response: { status: 400, data: { error: 'invalid_grant' } } })).toBe(true)
    expect(isSignInRefused(new Error('invalid_grant'))).toBe(true)
    expect(isSignInRefused({ response: { status: 500 } })).toBe(false)
    expect(isSignInRefused(new Error('getaddrinfo ENOTFOUND www.googleapis.com'))).toBe(false)
  })
})
