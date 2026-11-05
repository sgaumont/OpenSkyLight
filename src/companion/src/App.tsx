import { useEffect, useState, type ReactNode } from 'react'
import { GameIcon } from './components/ui'
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

// no Agenda tab (pages/AgendaPage.tsx is kept, unused, in case it comes back)
type TabId = 'lists' | 'meals' | 'chores' | 'photos' | 'notes'

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'chores', label: 'Chores', icon: <GameIcon /> },
  { id: 'lists', label: 'Lists', icon: '✓' },
  { id: 'meals', label: 'Meals', icon: '🍽' },
  { id: 'photos', label: 'Photos', icon: '🖼' },
  { id: 'notes', label: 'Notes', icon: '📝' }
]

export default function App() {
  const [paired, setPaired] = useState(() => getToken() !== null)
  const [tab, setTab] = useState<TabId>('chores')
  const today = useToday()
  // kiosk changes (a new note, a reply, a ticked chore) arrive instantly
  useLiveUpdates(paired)

  useEffect(() => {
    // any 401 (unpaired on the kiosk, evicted storage) drops back to pairing
    setUnauthorizedHandler(() => setPaired(false))
  }, [])

  if (!paired) return <PairScreen onRetry={() => setPaired(getToken() !== null)} />

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline gap-2 px-5 pt-5 pb-3" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        <h1 className="font-display text-2xl font-semibold">{TABS.find((t) => t.id === tab)?.label}</h1>
        <span className="text-sm font-bold text-ink-faint">{DateTime.fromISO(today).toFormat('ccc, LLL d')}</span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {/* sign-offs (checklists, Video Games) prompt on every tab, not just Chores (which has its own) */}
        {tab !== 'chores' && <ApprovalPrompt today={today} />}
        <div key={tab} className="animate-rise">
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
            onClick={() => setTab(t.id)}
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
