import { useEffect, useState } from 'react'
import { isNativeApp } from '../api/base'
import { availableUpdate, installUpdate, type TabletApp } from '../api/update'
import { PrimaryButton } from './ui'

/** How often to ask the tablet again while the app stays open or comes back to the front. */
const RECHECK_MS = 30 * 60_000

/**
 * Android app only: "a newer Family Skyview is on the tablet" with an Update button that downloads it
 * from the tablet and opens Android's install prompt. Nothing shows when up to date.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<TabletApp | null>(null)
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'downloading'; percent: number } | { kind: 'permission' } | { kind: 'error'; message: string }>({
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
    <div className="mx-4 mb-3 flex flex-col gap-2 rounded-2xl bg-card p-4 shadow-card" data-update-banner>
      <div className="text-base font-bold text-ink">⬆️ A new Family Skyview ({update.version}) is on the tablet</div>
      {state.kind === 'permission' && (
        <p className="text-sm font-semibold text-ink-soft">
          Allow <b>Install unknown apps</b> for Family Skyview in the screen that just opened, then come back and tap
          Update again.
        </p>
      )}
      {state.kind === 'error' && <p className="text-sm font-bold text-ember-deep">{state.message}</p>}
      <div className="flex [&>*]:flex-1">
        <PrimaryButton disabled={state.kind === 'downloading'} onClick={() => void run()}>
          {state.kind === 'downloading' ? `Downloading… ${state.percent}%` : 'Update'}
        </PrimaryButton>
      </div>
    </div>
  )
}
