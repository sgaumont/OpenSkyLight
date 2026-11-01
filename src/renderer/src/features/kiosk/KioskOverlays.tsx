import { useEffect, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import { useQuery } from '@tanstack/react-query'
import { ipcInvoke } from '../../api/client'
import { useSettings } from '../../api/hooks'
import { ZONE } from '../../stores/uiStore'
import { useKioskState } from '../../stores/kioskStore'
import { guardInput } from '@shared/inputGuard'
import { ShuffleDeck } from '@shared/shuffleDeck'

const WAKE_OVERRIDE_MS = 5 * 60 * 1000
const SLIDE_MS = 12_000

/**
 * Shuffled slideshow order, kept for the life of the app so each screensaver
 * session picks up where the last left off: every photo shows once per pass.
 */
const slideDeck = new ShuffleDeck<string>()

/** Handler for the tap that dismisses an overlay: it wakes the screen and nothing else. */
function consumeWakeTap(action: () => void) {
  return (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    guardInput(window)
    action()
  }
}

function useClock(): DateTime {
  const [now, setNow] = useState(() => DateTime.now().setZone(ZONE))
  useEffect(() => {
    const t = setInterval(() => setNow(DateTime.now().setZone(ZONE)), 10_000)
    return () => clearInterval(t)
  }, [])
  return now
}

function ScreensaverOverlay({ onDismiss }: { onDismiss: () => void }) {
  const { data: photos = [] } = useQuery({
    queryKey: ['screensaverPhotos'],
    queryFn: () => ipcInvoke('screensaver:listPhotos', undefined),
    staleTime: 60_000
  })
  const { data: settings } = useSettings()
  const [current, setCurrent] = useState<string | null>(null)
  const now = useClock()
  const timeFormat = settings?.timeFormat ?? '12h'
  // the list is re-fetched; only a real change of photos should reshuffle
  const photosKey = photos.join('\n')

  // photosKey stands in for photos as the dependency
  useEffect(() => {
    // an empty list (still loading) must not discard the pass in progress
    if (photos.length === 0) {
      setCurrent(null)
      return
    }
    slideDeck.setItems(photos)
    setCurrent(slideDeck.next() ?? null)
    if (photos.length < 2) return
    const t = setInterval(() => setCurrent(slideDeck.next() ?? null), SLIDE_MS)
    return () => clearInterval(t)
  }, [photosKey])

  const next = photos.length > 1 ? (slideDeck.peek() ?? null) : null

  return (
    <div className="fixed inset-0 z-[80] cursor-none bg-black" onPointerDown={consumeWakeTap(onDismiss)}>
      {current && (
        <img
          key={current}
          src={current}
          alt=""
          className="absolute inset-0 h-full w-full object-contain"
          style={{ animation: 'fade-in 1.2s ease both' }}
        />
      )}
      {/* preload the next slide so the crossfade never flashes */}
      {next && <img src={next} alt="" className="hidden" />}
      <div className="absolute bottom-10 left-12 select-none">
        <div className="font-display text-7xl font-semibold text-white/90 drop-shadow-lg">
          {timeFormat === '24h' ? now.toFormat('HH:mm') : now.toFormat('h:mm')}
        </div>
        <div className="mt-1 text-2xl font-bold text-white/70 drop-shadow-lg">{now.toFormat('cccc, LLLL d')}</div>
      </div>
    </div>
  )
}

function SleepOverlay({ onWake }: { onWake: () => void }) {
  const now = useClock()
  return (
    <div className="fixed inset-0 z-[90] cursor-none bg-black" onPointerDown={consumeWakeTap(onWake)}>
      <div className="absolute right-8 bottom-6 text-xl font-semibold text-white/15 select-none">
        {now.toFormat('h:mm a').toLowerCase()}
      </div>
    </div>
  )
}

/** Mounts the sleep and screensaver layers based on main-process kiosk events. */
export function KioskOverlays() {
  const [screensaver, setScreensaver] = useState(false)
  const [sleeping, setSleeping] = useState(false)
  const [awakeOverride, setAwakeOverride] = useState(false)
  const overrideTimer = useRef<number | null>(null)
  const setCovered = useKioskState((s) => s.setCovered)

  // let expensive tiles (camera streams) pause while a layer covers them
  const covered = (sleeping && !awakeOverride) || screensaver
  useEffect(() => {
    setCovered(covered)
  }, [covered, setCovered])

  useEffect(() => {
    const offIdle = window.osl.on('push:kioskIdle', (d) => {
      setScreensaver((d as { state?: string })?.state === 'screensaver')
    })
    const offSleep = window.osl.on('push:sleepState', (d) => {
      const isSleeping = Boolean((d as { sleeping?: boolean })?.sleeping)
      setSleeping(isSleeping)
      if (!isSleeping) {
        // window ended naturally — clear any tap-to-wake override
        setAwakeOverride(false)
        if (overrideTimer.current) window.clearTimeout(overrideTimer.current)
      }
    })
    return () => {
      offIdle()
      offSleep()
    }
  }, [])

  if (sleeping && !awakeOverride) {
    return (
      <SleepOverlay
        onWake={() => {
          setAwakeOverride(true)
          if (overrideTimer.current) window.clearTimeout(overrideTimer.current)
          overrideTimer.current = window.setTimeout(() => setAwakeOverride(false), WAKE_OVERRIDE_MS)
        }}
      />
    )
  }
  if (screensaver) return <ScreensaverOverlay onDismiss={() => setScreensaver(false)} />
  return null
}
