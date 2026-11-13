import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTabSwipe } from './lib/useTabSwipe'
import { startBackButton } from './lib/backButton'
import { StarIcon } from './components/ui'
import { DateTime } from 'luxon'
import { getToken, setUnauthorizedHandler } from './api/client'
import { useLiveUpdates } from './api/live'
import { usePendingUnlocks, useShopRequests, useToday } from './api/hooks'
import { ListsPage } from './pages/ListsPage'
import { MealsPage } from './pages/MealsPage'
import { ChoresPage } from './pages/ChoresPage'
import { TimersStrip } from './pages/TimersCard'
import { PhotosPage } from './pages/PhotosPage'
import { NotesPage } from './pages/NotesPage'
import { PairScreen } from './pages/PairScreen'
import { NotificationsSheet } from './pages/NotificationsSheet'
import { forgetNativePush, startNativePush } from './api/push'
import { UpdateBanner } from './components/UpdateBanner'

// no Agenda tab (pages/AgendaPage.tsx is kept, unused, in case it comes back)
type TabId = 'lists' | 'meals' | 'chores' | 'photos' | 'notes'

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'chores', label: 'Chores', icon: <StarIcon /> },
  { id: 'lists', label: 'Lists', icon: '✓' },
  { id: 'meals', label: 'Meals', icon: '🍽' },
  { id: 'photos', label: 'Photos', icon: '🖼' },
  { id: 'notes', label: 'Chat', icon: '💬' }
]

/** A tab named in the address (?tab=notes) — where a tapped notification opens the app. */
function tabFromUrl(): TabId | null {
  const t = new URLSearchParams(window.location.search).get('tab')
  return TABS.some((x) => x.id === t) ? (t as TabId) : null
}

export default function App() {
  const [paired, setPaired] = useState(() => getToken() !== null)
  const [tab, setTab] = useState<TabId>(() => tabFromUrl() ?? 'chores')
  const [notifications, setNotifications] = useState(false)
  // which way the last change went, so the new tab slides in from that side (taps just rise)
  const [slide, setSlide] = useState<'from-right' | 'from-left' | null>(null)
  const mainRef = useRef<HTMLElement>(null)
  const pick = (id: TabId): void => {
    setSlide(null)
    setTab(id)
  }
  const tabRef = useRef(tab)
  tabRef.current = tab
  const step = useCallback((dir: 1 | -1): void => {
    // no wrap-around: a swipe past the first or last tab does nothing
    const i = TABS.findIndex((t) => t.id === tabRef.current) + dir
    if (i < 0 || i >= TABS.length) return
    setSlide(dir === 1 ? 'from-right' : 'from-left')
    setTab(TABS[i].id)
  }, [])
  // Android back (the app only): open sheets close first (useBackHandler), then back through the
  // tabs visited, then the app steps aside to the background (lib/backButton.ts)
  const visited = useRef<TabId[]>([])
  const shownTab = useRef(tab)
  const goingBack = useRef(false)
  useEffect(() => {
    if (shownTab.current === tab) return
    if (!goingBack.current) visited.current = [...visited.current, shownTab.current].slice(-20)
    goingBack.current = false
    shownTab.current = tab
  }, [tab])
  useEffect(
    () =>
      startBackButton(() => {
        const prev = visited.current.pop()
        if (!prev) return false
        goingBack.current = true
        const from = TABS.findIndex((t) => t.id === tabRef.current)
        setSlide(TABS.findIndex((t) => t.id === prev) < from ? 'from-left' : 'from-right')
        setTab(prev)
        return true
      }),
    []
  )
  const today = useToday()
  // kiosk changes (a new note, a reply, a ticked chore) arrive instantly
  useLiveUpdates(paired)
  // swipe left / right anywhere on the page to change tabs (OPE-18)
  useTabSwipe(mainRef, step, paired)

  useEffect(() => {
    // any 401 (unpaired on the kiosk, evicted storage) drops back to pairing
    setUnauthorizedHandler(() => {
      // the Android app also stops getting the kiosk's notifications
      forgetNativePush()
      setPaired(false)
    })
  }, [])

  // Android app: a tapped notification opens its tab (even when the tap started the app), and a
  // new push token takes over this phone's notification settings on the kiosk
  useEffect(
    () =>
      startNativePush((t) => {
        if (TABS.some((x) => x.id === t)) pick(t as TabId)
      }),
    []
  )

  // a notification tapped while the app is already open: its service worker says which tab
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent): void => {
      const t = (e.data as { type?: string; tab?: string } | null)?.tab
      if ((e.data as { type?: string } | null)?.type === 'open-tab' && TABS.some((x) => x.id === t)) pick(t as TabId)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [])

  if (!paired) return <PairScreen onRetry={() => setPaired(getToken() !== null)} />

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-baseline gap-2 px-5 pt-5 pb-3"
        style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}
      >
        <h1 className="font-display text-2xl font-semibold">{TABS.find((t) => t.id === tab)?.label}</h1>
        <span className="flex-1 text-sm font-bold text-ink-faint">{DateTime.fromISO(today).toFormat('ccc, LLL d')}</span>
        {/* Android app: a newer version is on the tablet (a small chip, not a card) */}
        <UpdateBanner />
        <button
          type="button"
          onClick={() => setNotifications(true)}
          aria-label="This phone: name and notifications"
          className="pressable self-center rounded-full bg-paper-deep px-2.5 py-1.5 text-lg leading-none"
        >
          📱
        </button>
      </header>
      {notifications && <NotificationsSheet onClose={() => setNotifications(false)} />}
      {/* the kids' running timers, one slim line each on every tab; tap one to change it */}
      <TimersStrip />

      {/* Chat manages its own scrolling (messages scroll, the message box stays put); other tabs scroll here */}
      <main
        ref={mainRef}
        className={`min-h-0 flex-1 overflow-x-hidden px-4 ${tab === 'notes' ? 'flex flex-col overflow-y-hidden pb-2' : 'overflow-y-auto pb-4'}`}
        data-tab-main
      >
        <div
          key={tab}
          className={`${slide === 'from-right' ? 'animate-slide-from-right' : slide === 'from-left' ? 'animate-slide-from-left' : 'animate-rise'} ${
            tab === 'notes' ? 'flex min-h-0 flex-1 flex-col' : ''
          }`}
        >
          {tab === 'lists' && <ListsPage />}
          {tab === 'meals' && <MealsPage />}
          {tab === 'chores' && <ChoresPage />}
          {tab === 'photos' && <PhotosPage />}
          {tab === 'notes' && <NotesPage />}
        </div>
      </main>

      <nav className="flex border-t border-line bg-card" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => pick(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`pressable flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-extrabold ${
              tab === t.id ? 'text-ember' : 'text-ink-faint'
            }`}
          >
            <span className="relative text-lg leading-none">
              {t.icon}
              {/* sign-offs and Shop requests wait on the Chores tab; the count shows from every tab */}
              {t.id === 'chores' && <WaitingBadge today={today} />}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

/** How many sign-offs and Shop requests wait for a parent (their card is on Chores). Paired only. */
function WaitingBadge({ today }: { today: string }) {
  const { data: pending = [] } = usePendingUnlocks(today)
  const { data: requests = [] } = useShopRequests()
  const waiting = pending.length + requests.length
  if (waiting === 0) return null
  return (
    <span
      className="absolute -top-1.5 -right-3 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ember px-1 text-[11px] leading-none font-extrabold text-white"
      aria-label={`${waiting} waiting for a parent`}
      data-waiting-badge
    >
      {waiting}
    </span>
  )
}
