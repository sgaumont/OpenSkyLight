import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { getToken, setUnauthorizedHandler } from './api/client'
import { useToday } from './api/hooks'
import { ListsPage } from './pages/ListsPage'
import { MealsPage } from './pages/MealsPage'
import { ChoresPage } from './pages/ChoresPage'
import { PairScreen } from './pages/PairScreen'

// no Agenda tab (pages/AgendaPage.tsx is kept, unused, in case it comes back)
type TabId = 'lists' | 'meals' | 'chores'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'chores', label: 'Chores', icon: '★' },
  { id: 'lists', label: 'Lists', icon: '✓' },
  { id: 'meals', label: 'Meals', icon: '🍽' }
]

export default function App() {
  const [paired, setPaired] = useState(() => getToken() !== null)
  const [tab, setTab] = useState<TabId>('chores')
  const today = useToday()

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
        <div key={tab} className="animate-rise">
          {tab === 'lists' && <ListsPage />}
          {tab === 'meals' && <MealsPage />}
          {tab === 'chores' && <ChoresPage />}
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
