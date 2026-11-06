import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTabSwipe } from './lib/useTabSwipe'
import { StarIcon } from './components/ui'
import { DateTime } from 'luxon'
import { getToken, setUnauthorizedHandler } from './api/client'
import { useLiveUpdates } from './api/live'
import { usePeople, useToday } from './api/hooks'
import { ListsPage } from './pages/ListsPage'
import { MealsPage } from './pages/MealsPage'
import { ChoresPage, PendingUnlocksCard } from './pages/ChoresPage'
import { PhotosPage } from './pages/PhotosPage'
import { NotesPage } from './pages/NotesPage'
import { PairScreen } from './pages/PairScreen'
import { NotificationsSheet } from './pages/NotificationsSheet'

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
  const today = useToday()
  // kiosk changes (a new note, a reply, a ticked chore) arrive instantly
  useLiveUpdates(paired)
  // swipe left / right anywhere on the page to change tabs (OPE-18)
  useTabSwipe(mainRef, step, paired)

  useEffect(() => {
    // any 401 (unpaired on the kiosk, evicted storage) drops back to pairing
    setUnauthorizedHandler(() => setPaired(false))
  }, [])

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
      <header className="flex items-baseline gap-2 px-5 pt-5 pb-3" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        <h1 className="font-display text-2xl font-semibold">{TABS.find((t) => t.id === tab)?.label}</h1>
        <span className="flex-1 text-sm font-bold text-ink-faint">{DateTime.fromISO(today).toFormat('ccc, LLL d')}</span>
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

      <main ref={mainRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4" data-tab-main>
        {/* sign-offs (checklists, Video Games) prompt on every tab, not just Chores (which has its own) */}
        {tab !== 'chores' && <ApprovalPrompt today={today} />}
        <div key={tab} className={slide === 'from-right' ? 'animate-slide-from-right' : slide === 'from-left' ? 'animate-slide-from-left' : 'animate-rise'}>
          {tab === 'lists' && <ListsPage />}
          {tab === 'meals' && <MealsPage />}
          {tab === 'chores' && <ChoresPage />}
          {tab === 'photos' && <PhotosPage />}
          {tab === 'notes' && <NotesPage />}
        </div>
      </main>

      <nav
        className="flex border-t border-line bg-card"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
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
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

/** Waiting sign-offs, at the top of whatever tab is open. */
function ApprovalPrompt({ today }: { today: string }) {
  const { data: people = [] } = usePeople()
  return (
    <div className="mb-4 empty:hidden">
      <PendingUnlocksCard people={people} today={today} />
    </div>
  )
}
