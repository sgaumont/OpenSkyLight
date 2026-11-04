import { useEffect, useState } from 'react'
import { useBackupStatus, useGoogleStatus, useSyncStatus } from '../../api/hooks'
import { AlertIcon } from '../../components/icons'
import { useUi } from '../../stores/uiStore'
import { collectIssues } from '@shared/kioskIssues'

/**
 * The header's warning line: the most important problem (sign-in expired, a calendar not
 * updating, backups failing), "+N more" for the rest. A tap opens Settings where it's fixed.
 * Takes the header's free space; empty when all is well, just a ⚠ (and count) when squeezed.
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
    // a container, so a squeezed line (Week/Month, beside the date controls) shrinks to a ⚠ button
    <div className="@container flex min-w-0 flex-1 justify-center px-1">
      <button
        type="button"
        role="alert"
        aria-label={issues.map((i) => i.message).join('. ')}
        onClick={() => setSettingsOpen(true, first.tab)}
        title={issues.map((i) => i.message).join('\n')}
        className="pressable flex max-w-full min-w-0 items-center gap-2 rounded-2xl bg-ember/12 px-3 py-2 text-left text-base font-bold text-ember-deep max-[1300px]:text-sm @max-[11rem]:gap-1 @max-[11rem]:px-2"
      >
        <AlertIcon size={22} className="shrink-0" />
        <span className="line-clamp-2 min-w-0 @max-[11rem]:hidden">{first.message}</span>
        {issues.length > 1 && (
          <>
            <span className="shrink-0 font-extrabold whitespace-nowrap @max-[11rem]:hidden">+{issues.length - 1} more</span>
            <span className="hidden shrink-0 font-extrabold @max-[11rem]:inline">{issues.length}</span>
          </>
        )}
      </button>
    </div>
  )
}
