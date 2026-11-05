import { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { useQuery } from '@tanstack/react-query'
import { ipcInvoke } from '../../api/client'
import { useCountdowns, useGameTimers, useSettings, useWeather } from '../../api/hooks'
import { countdownLabel } from '@shared/countdown'
import { useCalendarData } from '../calendar/useCalendarData'
import { agendaRange } from '@shared/dates'
import { withoutEnded } from '@shared/occurrences'
import { weatherIcon } from '../weather/WeatherHeader'
import { ZONE } from '../../stores/uiStore'
import { useKioskState } from '../../stores/kioskStore'
import { guardInput } from '@shared/inputGuard'
import { ShuffleDeck } from '@shared/shuffleDeck'

const SLIDE_MS = 10_000

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
      {/* bottom-left: the clock with the weather just right of it, the date underneath
          (all 1.5× v0.8.115's sizes: time 108px, date 36px, temperature 54px) */}
      <div className="absolute bottom-10 left-12 select-none" data-screensaver-clock>
        <div className="flex items-center gap-9">
          <div className="font-display text-[108px] leading-none font-semibold text-white/90 drop-shadow-lg">
            {timeFormat === '24h' ? now.toFormat('HH:mm') : now.toFormat('h:mm')}
          </div>
          <ScreensaverWeather />
        </div>
        <div className="mt-1.5 text-4xl font-bold text-white/70 drop-shadow-lg">{now.toFormat('cccc, LLLL d')}</div>
      </div>
      <ScreensaverGlance now={now} />
      <ScreensaverCountdowns today={now.toISODate()!} />
    </div>
  )
}

/**
 * The header's weather — icon, current temperature, today's high over low — small, in the
 * screensaver's white-on-photo style, just right of the clock (the date runs underneath both).
 */
function ScreensaverWeather() {
  const { data: weather } = useWeather()
  if (!weather) return null
  const Icon = weatherIcon(weather.code, weather.isDay)
  const today = weather.daily[0]
  return (
    <div className="flex items-center gap-[15px] text-white/90 drop-shadow-lg" data-screensaver-weather>
      <Icon className="h-[66px] w-[66px]" />
      <span className="font-display text-[54px] leading-none font-semibold">{weather.temperature}°</span>
      {today && (
        <span
          className="flex flex-col items-end gap-[3px] text-[27px] leading-none font-bold tabular-nums"
          aria-label={`Today: high ${today.high}°, low ${today.low}°`}
        >
          <span>{today.high}°</span>
          <span className="text-white/60">{today.low}°</span>
        </span>
      )}
    </div>
  )
}

/** The frosted card the screensaver's Next up and Countdowns sit on. */
/** (Position is per card: Countdowns top-right, Next up bottom-right.) */
const GLANCE_CARD = 'absolute max-w-[40rem] rounded-3xl bg-black/45 px-7 py-6 text-white drop-shadow-lg backdrop-blur-sm select-none'

/**
 * What's next (four timed events, all one size), bottom-right over the photos: the rest of today, running into
 * tomorrow — marked "Tmrw", like the This week tile — once today's are done.
 */
function ScreensaverGlance({ now }: { now: DateTime }) {
  const { data: timers = [] } = useGameTimers()
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
    // bottom-right; lifted while a game timer pill sits at the bottom of the screen
    <div className={`${GLANCE_CARD} right-12 ${timers.length > 0 ? 'bottom-28' : 'bottom-10'}`} style={{ animation: 'fade-in 1.2s ease both' }}>
      <div className="text-sm font-extrabold tracking-wider text-white/60 uppercase">Next up</div>
      {upcoming.slice(0, 4).map(({ o, tomorrow }) => (
        <div key={o.key} className="mt-1 flex items-baseline gap-3 text-2xl font-bold" data-next-up-line>
          <span className="shrink-0 tabular-nums">
            {tomorrow && <span className="mr-2 text-white/60">Tmrw</span>}
            {Date.parse(o.start) <= now.toMillis() ? 'Now' : time(o.start)}
          </span>
          <span className="truncate">{o.title}</span>
        </div>
      ))}
    </div>
  )
}

/** The next three countdowns, top-right — Next up's twin, soonest first. */
function ScreensaverCountdowns({ today }: { today: string }) {
  const { data: countdowns = [] } = useCountdowns()
  const shown = countdowns
    .map((c) => ({ c, label: countdownLabel(c.date, today) }))
    .filter((x): x is { c: (typeof countdowns)[number]; label: string } => x.label !== null)
    .slice(0, 3)
  if (shown.length === 0) return null
  return (
    <div className={`${GLANCE_CARD} top-10 right-12`} style={{ animation: 'fade-in 1.2s ease both' }}>
      <div className="text-sm font-extrabold tracking-wider text-white/60 uppercase">Countdowns</div>
      {shown.map(({ c, label }, i) => (
        <div key={c.id} className={`flex items-baseline gap-3 ${i === 0 ? 'mt-1 text-2xl' : 'mt-1 text-lg text-white/70'} font-bold`}>
          <span className="truncate">
            {c.emoji ?? '⏳'} {c.title}
          </span>
          <span className="ml-auto shrink-0 pl-4 tabular-nums">{label}</span>
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
  const setSleepingState = useKioskState((s) => s.setSleeping)

  // let expensive tiles (camera streams) pause while a layer covers them
  const covered = sleeping || screensaver
  useEffect(() => {
    setCovered(covered)
  }, [covered, setCovered])
  useEffect(() => {
    setSleepingState(sleeping)
  }, [sleeping, setSleepingState])

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
