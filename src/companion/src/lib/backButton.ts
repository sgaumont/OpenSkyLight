import { useEffect, useRef } from 'react'
import { App as CapApp } from '@capacitor/app'
import { isNativeApp } from '../api/base'

/**
 * Android's back gesture / ◁ button in the Family Skyview app. Without this, Capacitor closes the
 * app on back, even with a sheet open. Now: the newest open sheet or mode closes first, then the
 * app goes back to the tab you came from, and only then does it step aside (to the background,
 * still running and connected, never quit). The web app is untouched: browsers own their back.
 */
const handlers: { current: () => void }[] = []

/** While `active`, back calls `onBack` (the newest active one wins), e.g. a sheet's close. */
export function useBackHandler(active: boolean, onBack: () => void): void {
  const ref = useRef(onBack)
  ref.current = onBack
  useEffect(() => {
    if (!active) return
    const entry = { current: () => ref.current() }
    handlers.push(entry)
    return () => {
      const i = handlers.lastIndexOf(entry)
      if (i >= 0) handlers.splice(i, 1)
    }
  }, [active])
}

/** One back press: the newest handler, else `fallback` (true = handled), else to the background. */
export function pressBack(fallback: () => boolean): 'handler' | 'fallback' | 'minimize' {
  const top = handlers.at(-1)
  if (top) {
    top.current()
    return 'handler'
  }
  if (fallback()) return 'fallback'
  void CapApp.minimizeApp().catch(() => undefined)
  return 'minimize'
}

/** Listen for Android back presses (Android app only). Returns the stop function. */
export function startBackButton(fallback: () => boolean): () => void {
  if (!isNativeApp()) return () => {}
  const sub = CapApp.addListener('backButton', () => {
    pressBack(fallback)
  })
  return () => void sub.then((s) => s.remove())
}
