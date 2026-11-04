import { useEffect, useRef } from 'react'
import { DateTime } from 'luxon'
import { usePushInvalidation, useSettings } from './api/hooks'
import { useTheme } from './lib/useTheme'
import { useUi, ZONE } from './stores/uiStore'
import { DEFAULT_SETTINGS } from '@shared/types'
import { tabZoom } from '@shared/textSize'
import { HomeView } from './features/home/HomeView'
import { Header, Fab } from './features/shell/Header'
import { Toasts } from './features/shell/Toasts'
import { UpdateBanner } from './features/shell/UpdateBanner'
import { WeekView } from './features/calendar/WeekView'
import { DayView } from './features/calendar/DayView'
import { MonthView } from './features/calendar/MonthView'
import { AgendaView } from './features/calendar/AgendaView'
import { ChoresView } from './features/chores/ChoresView'
import { ListsView } from './features/lists/ListsView'
import { EventEditor } from './features/calendar/EventEditor'
import { SettingsSheet } from './features/settings/SettingsSheet'
import { KioskOverlays } from './features/kiosk/KioskOverlays'
import { NoteOverlay } from './features/notes/NoteOverlay'
import { ApprovalOverlay } from './features/chores/ApprovalOverlay'
import { GameTimers } from './features/chores/GameTimers'
import { OskTray } from './components/Osk'

export default function App() {
  usePushInvalidation()
  useTheme()
  const view = useUi((s) => s.view)
  const { data: settings } = useSettings()
  const tabZoomValue = view === 'home' ? 1 : tabZoom(settings?.textSize ?? DEFAULT_SETTINGS.textSize, view)

  // Apply the configured default screen once at boot (only if the user
  // hasn't already navigated away from the initial view).
  const bootApplied = useRef(false)
  useEffect(() => {
    if (!settings || bootApplied.current) return
    bootApplied.current = true
    const state = useUi.getState()
    if (settings.defaultView !== state.view && state.view === 'home') {
      state.setView(settings.defaultView)
    }
  }, [settings])

  // At midnight, a screen that was showing today moves on to the new today
  // (otherwise a rolling week left up overnight would start yesterday).
  useEffect(() => {
    const todayKey = (): string => DateTime.now().setZone(ZONE).toISODate()!
    let current = todayKey()
    const t = setInterval(() => {
      const next = todayKey()
      if (next === current) return
      const state = useUi.getState()
      if (state.focusedDate === current) state.setFocusedDate(next)
      current = next
    }, 60_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <Header />
      <main className="min-h-0 flex-1">
        {/* per-tab text size; Home applies its size per tile instead, since
            zooming the grid would break its drag/resize pixel math */}
        <div className="h-full" style={tabZoomValue !== 1 ? { zoom: tabZoomValue } : undefined}>
          {view === 'home' && <HomeView />}
          {view === 'week' && <WeekView />}
          {view === 'day' && <DayView />}
          {view === 'month' && <MonthView />}
          {view === 'agenda' && <AgendaView />}
          {view === 'chores' && <ChoresView />}
          {view === 'lists' && <ListsView />}
        </div>
      </main>
      {view !== 'chores' && view !== 'lists' && view !== 'home' && <Fab />}
      <EventEditor />
      <SettingsSheet />
      <OskTray />
      <Toasts />
      <UpdateBanner />
      <KioskOverlays />
      {/* kids' game time counting down, and time's up */}
      <GameTimers />
      {/* finished Video Games sets waiting for a parent: over everything but notes and the sleep screen */}
      <ApprovalOverlay />
      {/* above the screensaver, under the sleep screen */}
      <NoteOverlay />
    </div>
  )
}
