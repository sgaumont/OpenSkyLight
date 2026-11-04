import { useEffect, useState } from 'react'
import { useBackupStatus, useGoogleStatus, useSyncStatus } from '../../api/hooks'
import { AlertIcon } from '../../components/icons'
import { useUi } from '../../stores/uiStore'
import { collectIssues } from '@shared/kioskIssues'

/**
 * The header's warning line: the most important problem (sign-in expired, a calendar not
 * updating, backups failing), "+N more" for the rest. A tap opens Settings where it's fixed.
 * Takes the header's free space; empty when all is well.
 */
export function IssueLine() {
  const { data: google } = useGoogleStatus()
  const { data: sync } = useSyncStatus()
  const { data: backup } = useBackupStatus()
  const setSettingsOpen = useUi((s) => s.setSettingsOpen)
  // re-judged every minute ("haven't updated for…" grows with time)
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const issues = collectIssues({ google, sync, backup, nowMs, uptimeMs: performance.now() })
  if (issues.length === 0) return <div className="min-w-0 flex-1" />
  const [first] = issues
  return (
    <div className="flex min-w-0 flex-1 justify-center px-2">
      <button
        type="button"
        role="alert"
        onClick={() => setSettingsOpen(true, first.tab)}
        title={issues.map((i) => i.message).join('\n')}
        className="pressable flex max-w-full min-w-0 items-center gap-2 rounded-2xl bg-ember/12 px-3 py-2 text-left text-base font-bold text-ember-deep max-[1300px]:text-sm"
      >
        <AlertIcon size={22} className="shrink-0" />
        <span className="line-clamp-2 min-w-0">{first.message}</span>
        {issues.length > 1 && <span className="shrink-0 font-extrabold whitespace-nowrap">+{issues.length - 1} more</span>}
      </button>
    </div>
  )
}
