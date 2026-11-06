import { app, BrowserWindow, dialog } from 'electron'
import { appendFileSync } from 'fs'
import { join } from 'path'
import { DateTime } from 'luxon'
import { openDatabase } from './db/client'
import { calendars } from './db/schema'
import { choreHistoryCutoff } from '@shared/choreHistory'
import { createSettingsService, migrateHomeGrid } from './services/settingsService'
import { createPeopleService } from './services/peopleService'
import { createCalendarService } from './services/calendarService'
import { createEventService } from './services/eventService'
import {
  buildChannelTable,
  dispatch,
  registerIpcHandlers,
  broadcast,
  onBroadcast,
  type ChannelTable,
  type Services
} from './ipc/router'
import { createCompanionTokens } from './companion/companionTokens'
import { createCompanionServer } from './companion/companionServer'
import { createMainWindow } from './window'
import { createBackupService } from './backup/backupService'
import { createNotesService } from './services/notesService'
import { createCountdownsService } from './services/countdownsService'
import { createTravelService } from './services/travelService'
import { createNotifyService } from './services/notifyService'
import { createPhonePhotos } from './companion/phonePhotos'
import { applyPendingRestore } from './backup/backupFiles'
import { createWeatherService } from './services/weatherService'
import { createAuthService } from './services/authService'
import { createChoresService } from './services/choresService'
import { createRewardsService } from './services/rewardsService'
import { createListsService } from './services/listsService'
import { createMealsService } from './services/mealsService'
import { createKiosk } from './kiosk/kiosk'
import { createUpdater } from './updater'
import { createRssService } from './services/rssService'
import { createCameraService } from './services/cameraService'
import { createBirdNetService } from './services/birdnetService'
import { createGoogleAuth } from './sync/googleAuth'
import { createGoogleSync } from './sync/googleSync'
import { createOutboxWorker } from './sync/outboxWorker'
import { createIcsSync } from './sync/icsSync'
import { createSyncManager } from './sync/scheduler'

// Test harnesses point this at a temp dir so smoke runs never touch real data
if (process.env.OSL_USER_DATA) {
  app.setPath('userData', process.env.OSL_USER_DATA)
}

// --tablet previews the Surface kiosk on a dev PC: 150% scaling, so its 1440×960 window is 2160×1440 pixels
if (process.argv.includes('--tablet')) app.commandLine.appendSwitch('force-device-scale-factor', '1.5')

/** Startup must never fail silently on a kiosk: log to userData/startup-error.log and say so on screen. */
let started = false
function reportFatal(where: string, err: unknown): void {
  const text = err instanceof Error ? (err.stack ?? err.message) : String(err)
  const file = join(app.getPath('userData'), 'startup-error.log')
  try {
    appendFileSync(file, `[${new Date().toISOString()}] v${app.getVersion()} ${where}\n${text}\n\n`)
  } catch {
    // nowhere to write; the dialog still shows it
  }
  console.error(`[main] ${where}:`, err)
  // once running, a stray failure (network, sync) is only logged — never a dialog over the kiosk
  if (!started && app.isReady()) {
    dialog.showErrorBox('OpenSkyLight could not start', `${where}\n\n${text}\n\nSaved to ${file}`)
  }
}
process.on('uncaughtException', (err) => reportFatal('Uncaught exception', err))
process.on('unhandledRejection', (err) => reportFatal('Unhandled rejection', err))

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(boot).catch((err) => {
    reportFatal('Startup failed', err)
    app.quit()
  })

  function boot(): void {
    const dbPath = join(app.getPath('userData'), 'openskylight.db')
    const backupsDir = join(app.getPath('userData'), 'backups')
    // a restore chosen in Settings is swapped in before the database is opened
    applyPendingRestore(dbPath, backupsDir, DateTime.now().toFormat('yyyy-LL-dd-HHmmss'))
    const { db, sqlite } = openDatabase(dbPath)
    const deviceTz = (): string => DateTime.local().zoneName ?? 'UTC'

    const settings = createSettingsService(db)
    migrateHomeGrid(settings)
    const kiosk = createKiosk({ settings, broadcast })
    const backup = createBackupService({ sqlite, dbPath, backupsDir, settings, deviceTz })
    const updater = createUpdater({ broadcast })
    const cameraService = createCameraService(settings)
    app.on('will-quit', () => cameraService.shutdown())
    const choresService = createChoresService(db, deviceTz)
    const googleAuth = createGoogleAuth(db, settings)
    const googleSync = createGoogleSync({ db, auth: googleAuth, deviceTz })
    const outbox = createOutboxWorker({
      db,
      sync: googleSync,
      onConflict: (title) => broadcast('push:syncConflict', { title })
    })
    const icsSync = createIcsSync({ db, deviceTz })
    // all-day events are stored as midnights in the device zone: after the zone changes
    // (or once, for data synced before this check), re-download every calendar in full
    if (settings.getRaw('sync.deviceTz') !== deviceTz()) {
      db.update(calendars).set({ syncToken: null, icsEtag: null, icsLastModified: null }).run()
      settings.setRaw('sync.deviceTz', deviceTz())
    }
    const syncManager = createSyncManager({
      db,
      auth: googleAuth,
      google: googleSync,
      outbox,
      ics: icsSync,
      broadcast
    })

    // companion dispatches through the same channel table built below; the
    // closure resolves after boot, before any HTTP request can arrive
    let channelTable: ChannelTable
    const companion = createCompanionServer({
      settings,
      tokens: createCompanionTokens(settings),
      dispatch: (channel, payload) => dispatch(services, channelTable, channel, payload, { gate: 'none' }),
      version: app.getVersion(),
      staticRoot: join(__dirname, '../companion'),
      photos: createPhonePhotos({ settings, onChange: (domain) => broadcast('push:dataChanged', { domain }) })
    })
    app.on('will-quit', () => companion.shutdown())
    onBroadcast((channel, payload) => {
      if (channel === 'push:dataChanged') companion.push((payload as { domain: string }).domain)
    })

    const eventsService = createEventService(db, deviceTz)
    // "Leave by" drive times for upcoming events (Google Routes API)
    const travel = createTravelService({
      settings,
      events: eventsService,
      onChange: () => broadcast('push:dataChanged', { domain: 'travel' })
    })
    // phone notifications; the sources read the services below, which exist before the first check
    const notify = createNotifyService({
      db,
      settings,
      deviceTz,
      sources: {
        names: () => new Map(services.people.list().map((p) => [p.id, p.name])),
        chat: () => services.notes.timeline(20),
        approvals: (today) => services.chores.pendingUnlocks(today),
        leaves: () => services.travel.leaveTimes(),
        timers: () => services.rewards.timers(),
        weather: async () =>
          ((await services.weather.get())?.alerts ?? []).filter((a) => a.kind === 'warning' || a.kind === 'watch')
      }
    })
    const services: Services = {
      settings,
      people: createPeopleService(db),
      calendars: createCalendarService(db),
      events: eventsService,
      googleAuth,
      googleSync,
      icsSync,
      syncManager,
      weather: createWeatherService(settings),
      auth: createAuthService(settings),
      chores: choresService,
      rewards: createRewardsService(db, choresService),
      lists: createListsService(db),
      meals: createMealsService(db),
      notes: createNotesService(db, deviceTz),
      countdowns: createCountdownsService(db, deviceTz),
      kiosk,
      backup,
      updater,
      rss: createRssService(),
      camera: cameraService,
      birdnet: createBirdNetService(),
      companion,
      travel,
      notify
    }
    channelTable = buildChannelTable(services)
    registerIpcHandlers(services, channelTable)
    // every (re)loaded page gets the overall text size, including after a renderer crash
    app.on('browser-window-created', (_event, win) => {
      win.webContents.on('did-finish-load', () => kiosk.applyTextSize())
    })
    createMainWindow()
    started = true
    syncManager.start()
    kiosk.start()
    backup.start()
    // chore completions are only kept for the few days the history shows
    const purgeChoreHistory = (): void => {
      choresService.purgeCompletionsBefore(choreHistoryCutoff(DateTime.now().setZone(deviceTz()).toISODate()!, deviceTz()))
    }
    purgeChoreHistory()
    setInterval(purgeChoreHistory, 60 * 60_000).unref()
    updater.start()
    companion.applySettings()
    travel.start()
    // a moved event, a new location or new travel settings: look again shortly (batched)
    let travelSoon: NodeJS.Timeout | null = null
    onBroadcast((channel, payload) => {
      const domain = (payload as { domain?: string } | null)?.domain
      if (channel !== 'push:dataChanged' || !domain || !['events', 'calendars', 'settings'].includes(domain)) return
      if (travelSoon) clearTimeout(travelSoon)
      travelSoon = setTimeout(() => void travel.refresh(), 5_000)
    })
    app.on('will-quit', () => travel.stop())
    // phones: a new chat message or a chore waiting for approval goes out right away, the rest on a timer
    notify.start()
    onBroadcast((channel, payload) => {
      const domain = (payload as { domain?: string } | null)?.domain
      if (channel === 'push:dataChanged' && (domain === 'notes' || domain === 'chores')) void notify.check()
    })
    app.on('will-quit', () => notify.stop())

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  }

  // A wall display should restart its UI if the renderer ever crashes
  app.on('render-process-gone', (_event, _webContents, details) => {
    console.error('[main] renderer gone:', details.reason)
    if (details.reason !== 'clean-exit') {
      for (const win of BrowserWindow.getAllWindows()) win.destroy()
      createMainWindow()
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
