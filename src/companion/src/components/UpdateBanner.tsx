import { useEffect, useState } from 'react'
import { isNativeApp } from '../api/base'
import { availableUpdate, installUpdate, type TabletApp } from '../api/update'
import { BottomSheet, GhostButton, PrimaryButton } from './ui'

/** How often to ask the tablet again while the app stays open or comes back to the front. */
const RECHECK_MS = 30 * 60_000

/**
 * Android app only: a small "⬆ Update" chip in the header when a newer Family Skyview is on the
 * tablet (was a full-width card on every tab until v0.8.177). Tapping it opens a sheet whose Update
 * button downloads it from the tablet and opens Android's install prompt. Nothing shows when up to date.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<TabletApp | null>(null)
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'downloading'; percent: number } | { kind: 'permission' } | { kind: 'error'; message: string }
  >({
    kind: 'idle'
  })

  useEffect(() => {
    if (!isNativeApp()) return
    let last = 0
    const check = (): void => {
      if (Date.now() - last < RECHECK_MS) return
      last = Date.now()
      void availableUpdate().then(setUpdate)
    }
    check()
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  if (!update) return null

  const run = async (): Promise<void> => {
    setState({ kind: 'downloading', percent: 0 })
    try {
      const r = await installUpdate(update.path, (percent) => setState({ kind: 'downloading', percent }))
      setState(r === 'permission' ? { kind: 'permission' } : { kind: 'idle' })
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message })
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable self-center rounded-full bg-ember px-3 py-1.5 text-sm font-extrabold text-white shadow-card"
        aria-label={`Update Family Skyview to ${update.version}`}
        data-update-chip
      >
        ⬆ Update
      </button>
      {open && (
        <BottomSheet onClose={() => setOpen(false)} label="Update Family Skyview">
          <div className="flex flex-col gap-3" data-update-banner>
            <div className="text-lg font-bold text-ink">⬆️ A new Family Skyview ({update.version}) is on the tablet</div>
            {state.kind === 'permission' && (
              <p className="text-sm font-semibold text-ink-soft">
                Allow <b>Install unknown apps</b> for Family Skyview in the screen that just opened, then come back and tap Update
                again.
              </p>
            )}
            {state.kind === 'error' && <p className="text-sm font-bold text-ember-deep">{state.message}</p>}
            <div className="flex [&>*]:flex-1">
              <PrimaryButton disabled={state.kind === 'downloading'} onClick={() => void run()}>
                {state.kind === 'downloading' ? `Downloading… ${state.percent}%` : 'Update'}
              </PrimaryButton>
            </div>
            <div className="flex [&>*]:flex-1">
              <GhostButton onClick={() => setOpen(false)}>Later</GhostButton>
            </div>
          </div>
        </BottomSheet>
      )}
    </>
  )
}
