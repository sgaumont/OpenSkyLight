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
  type ChannelTable,
  type Services
} from './ipc/router'
import { createCompanionTokens } from './companion/companionTokens'
import { createCompanionServer } from './companion/companionServer'
import { createMainWindow } from './window'
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
    const { db } = openDatabase(join(app.getPath('userData'), 'openskylight.db'))
    const deviceTz = (): string => DateTime.local().zoneName ?? 'UTC'

    const settings = createSettingsService(db)
    migrateHomeGrid(settings)
    const kiosk = createKiosk({ settings, broadcast })
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
      staticRoot: join(__dirname, '../companion')
    })
    app.on('will-quit', () => companion.shutdown())

    const services: Services = {
      settings,
      people: createPeopleService(db),
      calendars: createCalendarService(db),
      events: createEventService(db, deviceTz),
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
      kiosk,
      updater,
      rss: createRssService(),
      camera: cameraService,
      birdnet: createBirdNetService(),
      companion
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
    // chore completions are only kept for the few days the history shows
    const purgeChoreHistory = (): void => {
      choresService.purgeCompletionsBefore(choreHistoryCutoff(DateTime.now().setZone(deviceTz()).toISODate()!, deviceTz()))
    }
    purgeChoreHistory()
    setInterval(purgeChoreHistory, 60 * 60_000).unref()
    updater.start()
    companion.applySettings()

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
