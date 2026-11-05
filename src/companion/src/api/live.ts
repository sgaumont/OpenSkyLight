import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getToken } from './client'

/** Retry delay after the stream drops (kiosk restarting, Wi-Fi ↔ Tailscale hand-off). */
const RETRY_MS = 3000

/**
 * Listen to the kiosk's change stream (GET /api/events) and refetch the moment anything
 * changes — a note or reply shows up in about a second instead of on the 20s poll, which
 * stays as the fallback. fetch, not EventSource, so the token goes in a header (never the URL).
 */
export function useLiveUpdates(enabled: boolean): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let ctrl: AbortController | null = null
    let wake: (() => void) | null = null
    // set when the phone wakes: reconnect at once instead of after the retry delay
    let reconnectNow = false

    const refresh = (): void => void queryClient.invalidateQueries()

    const run = async (): Promise<void> => {
      let first = true
      while (!stopped) {
        ctrl = new AbortController()
        try {
          const res = await fetch('/api/events', {
            headers: { Authorization: `Bearer ${getToken() ?? ''}` },
            signal: ctrl.signal,
            cache: 'no-store'
          })
          if (res.status === 401) return // unpaired: the next rpc call drops to the pairing screen
          if (!res.ok || !res.body) throw new Error(`events ${res.status}`)
          // anything that changed while the stream was down
          if (!first) refresh()
          first = false
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
          let buf = ''
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buf += value
            let end: number
            while ((end = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, end)
              buf = buf.slice(end + 2)
              if (block.split('\n').some((line) => line.startsWith('data:'))) refresh()
            }
          }
        } catch {
          // dropped or aborted: fall through to the retry
        }
        if (stopped) return
        if (reconnectNow) {
          reconnectNow = false
          continue
        }
        // wait, unless the phone wakes up first
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, RETRY_MS)
          wake = () => {
            clearTimeout(t)
            resolve()
          }
        })
        wake = null
        reconnectNow = false
      }
    }

    // a phone coming back from sleep usually holds a dead stream: start a fresh one now
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      reconnectNow = true
      ctrl?.abort()
      wake?.()
    }
    document.addEventListener('visibilitychange', onVisible)
    void run()
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisible)
      ctrl?.abort()
      wake?.()
    }
  }, [enabled, queryClient])
}
