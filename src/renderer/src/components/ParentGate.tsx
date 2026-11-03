import { useRef, useState, type ReactNode } from 'react'
import { ipcInvoke } from '../api/client'
import { useAuthMutations } from '../api/hooks'
import { PinDialog } from './PinDialog'

/**
 * Runs an action only for a parent: straight away when no PIN is set or the lock is
 * already open, otherwise after the PIN is entered. The lock state is read fresh each
 * time (the unlock window expires on its own). `relock` closes the lock again if this
 * gate opened it. Render `dialog` once.
 */
export function useParentGate(): {
  guard: (action: () => void, onCancel?: () => void) => void
  relock: () => void
  dialog: ReactNode
} {
  const authMutations = useAuthMutations()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<{ action: () => void; onCancel?: () => void } | null>(null)
  const unlockedHere = useRef(false)

  const guard = (action: () => void, onCancel?: () => void): void => {
    void ipcInvoke('auth:getStatus', undefined).then((status) => {
      if (!status.pinSet || status.unlocked) {
        action()
        return
      }
      pending.current = { action, onCancel }
      setError(null)
      setOpen(true)
    })
  }

  const relock = (): void => {
    if (!unlockedHere.current) return
    unlockedHere.current = false
    authMutations.lock.mutate(undefined)
  }

  return {
    guard,
    relock,
    dialog: (
      <PinDialog
        open={open}
        title="Enter parent PIN"
        error={error}
        onClose={() => {
          setOpen(false)
          const cancelled = pending.current
          pending.current = null
          cancelled?.onCancel?.()
        }}
        onSubmit={(pin) =>
          authMutations.verifyPin.mutate(
            { pin },
            {
              onSuccess: (res) => {
                if (!res.valid) {
                  setError('Wrong PIN — try again')
                  return
                }
                unlockedHere.current = true
                setOpen(false)
                const next = pending.current
                pending.current = null
                next?.action()
              }
            }
          )
        }
      />
    )
  }
}
