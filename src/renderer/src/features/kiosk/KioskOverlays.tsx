import { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { useQuery } from '@tanstack/react-query'
import { ipcInvoke } from '../../api/client'
import { useSettings, useWeather } from '../../api/hooks'
import { useCalendarData } from '../calendar/useCalendarData'
import { agendaRange } from '@shared/dates'
import { withoutEnded } from '@shared/occurrences'
import { weatherIcon } from '../weather/WeatherHeader'
import { ZONE } from '../../stores/uiStore'
import { useKioskState } from '../../stores/kioskStore'
import { guardInput } from '@shared/inputGuard'
import { ShuffleDeck } from '@shared/shuffleDeck'

const SLIDE_MS = 10_000
/** How often the Next up card swaps sides. */
const GLANCE_SWAP_MS = 60_000

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
      <ScreensaverWeather />
      <ScreensaverGlance now={now} />
    </div>
  )
}

/**
 * The header's weather — icon, current temperature, today's high over low — in the
 * screensaver's white-on-photo style, bottom-right. Raised by the date line's height
 * (mt-1 + text-2xl line) so it lines up with the clock digits on the left.
 */
function ScreensaverWeather() {
  const { data: weather } = useWeather()
  if (!weather) return null
  const Icon = weatherIcon(weather.code, weather.isDay)
  const today = weather.daily[0]
  return (
    <div className="absolute right-12 bottom-[4.75rem] flex items-center gap-4 text-white/90 drop-shadow-lg select-none">
      <Icon className="h-[72px] w-[72px]" />
      <span className="font-display text-7xl leading-none font-semibold">{weather.temperature}°</span>
      {today && (
        <span
          className="flex flex-col items-end gap-1 text-3xl leading-none font-bold tabular-nums"
          aria-label={`Today: high ${today.high}°, low ${today.low}°`}
        >
          <span>{today.high}°</span>
          <span className="text-white/60">{today.low}°</span>
        </span>
      )}
    </div>
  )
}

/**
 * What's next (three timed events), top-left over the photos: the rest of today, running into
 * tomorrow — marked "Tmrw", like the This week tile — once today's are done.
 */
function ScreensaverGlance({ now }: { now: DateTime }) {
  // swaps between the left and right of the screen, fading in on each move
  const [right, setRight] = useState(false)
  useEffect(() => {
    const t = setInterval(() => setRight((r) => !r), GLANCE_SWAP_MS)
    return () => clearInterval(t)
  }, [])
  const todayKey = now.toISODate()!
  const tomorrowKey = now.plus({ days: 1 }).toISODate()!
  const range = useMemo(() => agendaRange(todayKey, ZONE, 2), [todayKey])
  const { byDay } = useCalendarData(range)
  const timed = (key: string) => (byDay.get(key) ?? []).filter((o) => !o.allDay)
  const today = withoutEnded(timed(todayKey), now.toMillis())
  const todayKeys = new Set(today.map((o) => o.key))
  const upcoming = [
    ...today.map((o) => ({ o, tomorrow: false })),
    // an event running past midnight is listed on both days: keep it under today
    ...timed(tomorrowKey)
      .filter((o) => !todayKeys.has(o.key))
      .map((o) => ({ o, tomorrow: true }))
  ]
  if (upcoming.length === 0) return null
  const time = (iso: string) => DateTime.fromISO(iso).setZone(ZONE).toFormat('h:mm a').toLowerCase()
  return (
    // keyed by side so the fade-in plays again on each swap
    <div
      key={right ? 'right' : 'left'}
      className={`absolute top-10 max-w-[60rem] rounded-3xl bg-black/45 px-7 py-6 text-white drop-shadow-lg backdrop-blur-sm select-none ${
        right ? 'right-12 text-right' : 'left-12'
      }`}
      style={{ animation: 'fade-in 1.2s ease both' }}
    >
      <div className="text-sm font-extrabold tracking-wider text-white/60 uppercase">Next up</div>
      {upcoming.slice(0, 3).map(({ o, tomorrow }, i) => (
        <div key={o.key} className={`flex items-baseline gap-3 ${right ? 'justify-end' : ''} ${i === 0 ? 'mt-1 text-2xl' : 'mt-1 text-lg text-white/70'} font-bold`}>
          <span className="shrink-0 tabular-nums">
            {tomorrow && <span className="mr-2 text-white/60 uppercase">Tmrw</span>}
            {Date.parse(o.start) <= now.toMillis() ? 'Now' : time(o.start)}
          </span>
          <span className="truncate">{o.title}</span>
        </div>
      ))}
    </div>
  )
}

function SleepOverlay({ onWake }: { onWake: () => void }) {
  const now = useClock()
  return (
    <div className="fixed inset-0 z-[90] cursor-none bg-black" onPointerDown={consumeWakeTap(onWake)}>
      <div className="absolute right-8 bottom-6 flex items-center gap-[72px] text-[90px] leading-none font-semibold text-white/15 select-none">
        <SleepWeather />
        <span>{now.toFormat('h:mm a').toLowerCase()}</span>
      </div>
    </div>
  )
}

/** The screensaver's weather, as faint as the sleep clock it sits beside. */
function SleepWeather() {
  const { data: weather } = useWeather()
  if (!weather) return null
  const Icon = weatherIcon(weather.code, weather.isDay)
  const today = weather.daily[0]
  return (
    <span className="flex items-center gap-9">
      <Icon className="h-[108px] w-[108px]" />
      <span>{weather.temperature}°</span>
      {today && (
        <span
          className="flex flex-col items-end text-[50px] leading-tight tabular-nums"
          aria-label={`Today: high ${today.high}°, low ${today.low}°`}
        >
          <span>{today.high}°</span>
          <span className="opacity-70">{today.low}°</span>
        </span>
      )}
    </span>
  )
}

/** Mounts the sleep and screensaver layers based on main-process kiosk events. */
export function KioskOverlays() {
  const [screensaver, setScreensaver] = useState(false)
  const [sleeping, setSleeping] = useState(false)
  const setCovered = useKioskState((s) => s.setCovered)

  // let expensive tiles (camera streams) pause while a layer covers them
  const covered = sleeping || screensaver
  useEffect(() => {
    setCovered(covered)
  }, [covered, setCovered])

  useEffect(() => {
    const offIdle = window.osl.on('push:kioskIdle', (d) => {
      setScreensaver((d as { state?: string })?.state === 'screensaver')
    })
    // main decides: asleep in the window, except while woken and still in use
    const offSleep = window.osl.on('push:sleepState', (d) => {
      setSleeping(Boolean((d as { sleeping?: boolean })?.sleeping))
    })
    return () => {
      offIdle()
      offSleep()
    }
  }, [])

  if (sleeping) {
    return (
      <SleepOverlay
        onWake={() => {
          setSleeping(false) // instant; main confirms and keeps it awake while in use
          void ipcInvoke('kiosk:wake', undefined)
        }}
      />
    )
  }
  if (screensaver) return <ScreensaverOverlay onDismiss={() => setScreensaver(false)} />
  return null
}
