import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import { useQuery } from '@tanstack/react-query'
import { ipcInvoke } from '../../api/client'
import { useCountdowns, useGameTimers, useLeaveTimes, useMeals, useSettings, useWeather } from '../../api/hooks'
import { SLOT_META } from '../meals/Meals'
import { mealsAhead } from '@shared/mealsAhead'
import { ClothingEmoji } from '../weather/Clothing'
import { countdownLabel } from '@shared/countdown'
import { useCalendarData } from '../calendar/useCalendarData'
import { agendaRange } from '@shared/dates'
import { withoutEnded } from '@shared/occurrences'
import { weatherIcon } from '../weather/WeatherHeader'
import { alertColours, alertSummary } from '../weather/WeatherAlerts'
import { AlertIcon } from '../../components/icons'
import { useUi, ZONE } from '../../stores/uiStore'
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
      {/* top-left: the clock with the weather just right of it, the date underneath
          (all 1.5× v0.8.115's sizes: time 108px, date 36px, temperature 54px) */}
      <div className="absolute top-2.5 left-6 select-none" data-screensaver-clock>
        <div className="flex items-center gap-9">
          <div className="font-display text-[108px] leading-none font-semibold text-white/90 drop-shadow-lg">
            {timeFormat === '24h' ? now.toFormat('HH:mm') : now.toFormat('h:mm')}
          </div>
          <ScreensaverWeather />
          {/* a light disc: Windows draws the jacket dark grey, lost on a dark photo otherwise */}
          <ClothingEmoji className="flex h-[78px] w-[78px] items-center justify-center rounded-full bg-white/85 text-[48px] leading-none shadow-lg" />
        </div>
        <div className="mt-1.5 text-4xl font-bold text-white/70 drop-shadow-lg">{now.toFormat('cccc, LLLL d')}</div>
        <ScreensaverAlert />
      </div>
      <ScreensaverBottomCards now={now} />
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

/**
 * A weather warning under the date, in its Environment Canada colour but see-through (the photo
 * shows through it); "+N" for any others. Nothing when there's no alert.
 */
function ScreensaverAlert() {
  const { data: weather } = useWeather()
  const alerts = weather?.alerts ?? []
  if (alerts.length === 0) return null
  const { bg } = alertColours(alerts[0].colour)
  return (
    <div
      className="mt-3 inline-flex max-w-[44rem] items-center gap-2.5 rounded-full px-5 py-2 text-2xl font-bold text-white/90 drop-shadow-lg"
      // the alert colour at 35%: plainly a warning, but light enough not to cover the photo
      style={{ backgroundColor: `${bg}59` }}
      data-screensaver-alert
    >
      <AlertIcon size={26} className="shrink-0" />
      <span className="truncate">{alertSummary(alerts)}</span>
    </div>
  )
}

/** The small uppercase label over a screensaver card's lines ("Next up", "Tomorrow", "Countdowns"). */
const SMALL_HEADER = 'text-sm font-extrabold tracking-wider text-white/60 uppercase'

/** How big the screensaver cards are drawn (v0.8.162: 75% × 1.25). Zoom, so they lay out at that size. */
const CARD_ZOOM = 0.9375

/**
 * The frosted card the screensaver's Next up, Meals and Countdowns sit on. (Position is per card, on
 * a wrapper outside the zoom: Countdowns top-right, Meals bottom-left, Next up bottom-right.) Padding
 * and corners are divided by the zoom so they stay 12px / 9px / 12px on screen whatever the card size.
 */
const GLANCE_CARD = 'max-w-[40rem] bg-black/34 text-white drop-shadow-lg backdrop-blur-sm select-none'
const STACK_CARD: React.CSSProperties = {
  zoom: CARD_ZOOM,
  padding: `${9 / CARD_ZOOM}px ${12 / CARD_ZOOM}px`,
  borderRadius: 12 / CARD_ZOOM,
  animation: 'fade-in 1.2s ease both'
}

/**
 * The bottom corners, 10px / 24px from the edges: today's meals still to come bottom-left, Next up
 * bottom-right. Both lift clear while a game timer pill sits at the bottom of the screen.
 */
function ScreensaverBottomCards({ now }: { now: DateTime }) {
  const { data: timers = [] } = useGameTimers()
  const bottom = timers.length > 0 ? 'bottom-28' : 'bottom-2.5'
  return (
    <>
      <div className={`absolute left-6 ${bottom}`}>
        <ScreensaverMeals now={now} />
      </div>
      <div className={`absolute right-6 ${bottom}`}>
        <ScreensaverGlance now={now} />
      </div>
    </>
  )
}

/** Today's meals, Next up's twin: breakfast goes at 9 am, lunch at 1 pm, dinner at 6 pm; the snack stays, last. */
function ScreensaverMeals({ now }: { now: DateTime }) {
  const todayKey = now.toISODate()!
  const { data: meals = [] } = useMeals(todayKey, todayKey)
  const shown = mealsAhead(meals, now.hour)
  if (shown.length === 0) return null
  return (
    <div className={GLANCE_CARD} style={STACK_CARD} data-meals-card>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4">
        <div className={`col-span-2 ${SMALL_HEADER}`}>Meals today</div>
        {shown.map((m) => (
          <Fragment key={m.slot}>
            {/* the meal's colour as a dot (the purple snack is too dark for text on the frosted card) */}
            <span className="mt-1 flex items-center gap-2.5 text-2xl font-bold text-white/70" data-meal-line={m.slot}>
              <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: SLOT_META[m.slot].color }} />
              {SLOT_META[m.slot].label}
            </span>
            <span className="mt-1 truncate text-2xl font-bold">{m.text}</span>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/**
 * What's next (five timed events, all one size), bottom-right over the photos: the rest of today, running into
 * tomorrow — under a small "Tomorrow" header — once today's are done.
 */
function ScreensaverGlance({ now }: { now: DateTime }) {
  const { data: leaveTimes = [] } = useLeaveTimes()
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
  const leaveFor = (key: string) => leaveTimes.find((t) => t.key === key)
  return (
    <div className={GLANCE_CARD} style={STACK_CARD} data-next-up-card>
      {/* one grid (time | title | leave by), so every title starts in line whatever the time's width;
          tomorrow's events sit under their own small header, like Next up's */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3">
        <div className={`col-span-3 ${SMALL_HEADER}`}>Next up</div>
        {upcoming.slice(0, 5).map(({ o, tomorrow }, i, shown) => (
          <Fragment key={o.key}>
            {tomorrow && !shown[i - 1]?.tomorrow && (
              <div className={`col-span-3 ${i > 0 ? 'mt-2' : ''} ${SMALL_HEADER}`} data-next-up-tomorrow>
                Tomorrow
              </div>
            )}
            <span className="mt-1 text-2xl font-bold tabular-nums" data-next-up-line>
              {Date.parse(o.start) <= now.toMillis() ? 'Now' : time(o.start)}
            </span>
            <span className="mt-1 truncate text-2xl font-bold">{o.title}</span>
            <span className="mt-1 pl-2 text-2xl font-bold text-white/70 tabular-nums">
              {leaveFor(o.key) && <span data-next-up-leave>🚗 {time(leaveFor(o.key)!.leaveAt)}</span>}
            </span>
          </Fragment>
        ))}
      </div>
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
    // the wrapper holds the 10px / 24px corner margins; the card inside is drawn at 75%, like the bottom cards
    <div className="absolute top-2.5 right-6">
      <div className={GLANCE_CARD} style={STACK_CARD} data-countdowns-card>
        <div className="text-sm font-extrabold tracking-wider text-white/60 uppercase">Countdowns</div>
        {/* all one size, like Next up's lines — the soonest isn't singled out */}
        {shown.map(({ c, label }) => (
          <div key={c.id} className="mt-1 flex items-baseline gap-3 text-2xl font-bold" data-countdown-line>
            <span className="truncate">
              {c.emoji ?? '⏳'} {c.title}
            </span>
            <span className="ml-auto shrink-0 pl-4 tabular-nums">{label}</span>
          </div>
        ))}
      </div>
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
  // back from the screensaver or sleep: a fresh start — the default screen (Home), on today
  // (OPE-19), with Settings or an event editor someone left open closed
  const goToday = useUi((s) => s.goToday)
  const setView = useUi((s) => s.setView)
  const setSettingsOpen = useUi((s) => s.setSettingsOpen)
  const closeEditor = useUi((s) => s.closeEditor)
  const { data: kioskSettings } = useSettings()
  const defaultView = kioskSettings?.defaultView ?? 'home'
  const wasCovered = useRef(false)
  useEffect(() => {
    if (wasCovered.current && !covered) {
      setView(defaultView)
      goToday()
      setSettingsOpen(false)
      closeEditor()
    }
    wasCovered.current = covered
  }, [covered, goToday, setView, defaultView, setSettingsOpen, closeEditor])
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
