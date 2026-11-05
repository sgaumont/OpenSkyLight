import type { WeatherAlert } from '../weatherAlerts'
import type {
  AppSettings,
  BackupStatus,
  CountdownDto,
  CountdownInput,
  GameTimeLogEntry,
  GameTimerDto,
  CalendarCreateInput,
  CalendarDto,
  CalendarUpdateInput,
  ChecklistDto,
  ChecklistInput,
  ChoreCreateInput,
  ChoreDto,
  ChoreUpdateInput,
  DayChecklistDto,
  DayChoreDto,
  EventCreateInput,
  EventDeleteInput,
  EventDto,
  EventUpdateInput,
  ListDto,
  ListItemDto,
  ListKind,
  MealSlotDto,
  MealSlotKind,
  NoteDto,
  NoteInput,
  NoteReplyDto,
  NoteReplyInput,
  OccurrenceDto,
  PendingUnlockDto,
  PersonCreateInput,
  PersonDto,
  PersonUpdateInput,
  RedemptionDto,
  RewardDto,
  StarBalanceDto
} from '../types'

/**
 * The single source of truth for renderer <-> main communication.
 * Every operation appears here once; main registers a zod-validated handler per
 * channel and the renderer gets a fully typed `ipcInvoke`.
 */
export type IpcContract = {
  'app:getInfo': { req: void; res: { version: string; platform: string; zone: string } }
  'app:installUpdate': { req: void; res: void }

  'settings:getAll': { req: void; res: AppSettings }
  'settings:set': { req: { patch: Partial<AppSettings> }; res: AppSettings }

  'people:list': { req: void; res: PersonDto[] }
  'people:create': { req: PersonCreateInput; res: PersonDto }
  'people:update': { req: PersonUpdateInput; res: PersonDto }
  'people:delete': { req: { id: string }; res: void }

  'calendars:list': { req: void; res: CalendarDto[] }
  'calendars:create': { req: CalendarCreateInput; res: CalendarDto }
  'calendars:update': { req: CalendarUpdateInput; res: CalendarDto }
  'calendars:delete': { req: { id: string }; res: void }

  'events:getOccurrences': { req: { start: string; end: string }; res: OccurrenceDto[] }
  'events:get': { req: { id: string }; res: EventDto | null }
  'events:create': { req: EventCreateInput; res: EventDto }
  'events:update': { req: EventUpdateInput; res: void }
  'events:delete': { req: EventDeleteInput; res: void }

  'google:getStatus': {
    req: void
    res: { configured: boolean; accounts: { id: string; email: string; error: string | null }[] }
  }
  'google:setCredentials': { req: { clientId: string; clientSecret: string }; res: void }
  'google:connect': { req: void; res: { email: string } }
  'google:disconnect': { req: { accountId: string }; res: void }
  'google:listRemoteCalendars': {
    req: { accountId: string }
    res: { id: string; name: string; color: string; primary: boolean; readOnly: boolean; selected: boolean }[]
  }
  'google:setCalendarSelected': {
    req: {
      accountId: string
      googleCalendarId: string
      name: string
      color: string
      readOnly: boolean
      selected: boolean
    }
    res: void
  }

  'ics:add': { req: { url: string; name: string; color: string }; res: CalendarDto }

  'chores:list': { req: void; res: ChoreDto[] }
  'chores:create': { req: ChoreCreateInput; res: ChoreDto }
  'chores:update': { req: ChoreUpdateInput; res: ChoreDto }
  'chores:delete': { req: { id: string }; res: void }
  'chores:getDay': { req: { date: string }; res: DayChoreDto[] }
  /** unlocked = the checklist title when this tick finished one for that person */
  'chores:complete': { req: { choreId: string; date: string; personId: string }; res: { balance: number; unlocked?: string } }
  'chores:uncomplete': { req: { choreId: string; date: string; personId?: string }; res: { balance: number } }
  'chores:checklists': { req: void; res: ChecklistDto[] }
  'chores:checklistCreate': { req: ChecklistInput; res: ChecklistDto }
  'chores:checklistUpdate': { req: ChecklistInput & { id: string }; res: ChecklistDto }
  'chores:checklistDelete': { req: { id: string }; res: void }
  'chores:checklistsDay': { req: { date: string }; res: DayChecklistDto[] }
  'chores:pendingUnlocks': { req: { date: string }; res: PendingUnlockDto[] }
  /** `round`: which finished Video Games round (checklistId = VIDEO_GAMES_SET_ID) */
  'chores:approveUnlock': { req: { checklistId: string; personId: string; date: string; round?: number }; res: void }
  /** controllers paid per finished Video Games round */
  'chores:videoGamesStars': { req: void; res: { stars: number } }
  'chores:setVideoGamesStars': { req: { stars: number }; res: { stars: number } }

  'stars:balances': { req: void; res: StarBalanceDto[] }
  /** a parent's correction: adds `delta` (may be negative) to the person's balance */
  'stars:adjust': { req: { personId: string; delta: number }; res: { balance: number } }
  /** a kid uses all their saved-up controllers ("use your time"): balance → 0; not PIN-gated */
  'stars:useTime': { req: { personId: string }; res: { used: number; minutes: number; timer: GameTimerDto | null } }
  /** game timers counting down (and finished ones not yet acknowledged) */
  'stars:timers': { req: void; res: GameTimerDto[] }
  /** stop early: the time left comes back as controllers (rounded up to a minute, capped at what was spent) */
  'stars:stopTimer': { req: { id: string }; res: { refunded: number } }
  /** the game time log, newest first; one kid or everyone */
  'stars:log': { req: { personId: string | null; limit: number }; res: GameTimeLogEntry[] }

  'lists:getAll': { req: void; res: ListDto[] }
  'lists:create': { req: { name: string; color: string; kind: ListKind }; res: ListDto }
  'lists:update': { req: { id: string; name?: string; color?: string }; res: ListDto }
  'lists:delete': { req: { id: string }; res: void }
  'listItems:add': { req: { listId: string; text: string }; res: ListItemDto }
  'listItems:toggle': { req: { id: string }; res: void }
  'listItems:delete': { req: { id: string }; res: void }
  'listItems:clearChecked': { req: { listId: string }; res: void }

  'meals:getRange': { req: { start: string; end: string }; res: MealSlotDto[] }
  'meals:set': { req: { date: string; slot: MealSlotKind; text: string | null }; res: void }

  /** today's and future countdowns, soonest first */
  'countdowns:list': { req: void; res: CountdownDto[] }
  'countdowns:create': { req: CountdownInput; res: CountdownDto }
  'countdowns:update': { req: CountdownInput & { id: string }; res: CountdownDto }
  'countdowns:delete': { req: { id: string }; res: void }

  'notes:list': { req: void; res: NoteDto[] }
  'notes:add': { req: NoteInput; res: NoteDto }
  /** the phone's conversations: on the kiosk now, plus the last couple of days' */
  'notes:recent': { req: void; res: NoteDto[] }
  /** a reply from a phone (puts a done note back on the kiosk) */
  'notes:reply': { req: NoteReplyInput; res: NoteReplyDto }
  /** a reply tapped or typed on the tablet — kiosk-only, so a phone can't post as the tablet */
  'notes:kioskReply': { req: { noteId: string; text: string }; res: NoteReplyDto }
  'notes:done': { req: { id: string }; res: void }

  'rewards:list': { req: void; res: RewardDto[] }
  'rewards:create': { req: { title: string; costStars: number }; res: RewardDto }
  'rewards:update': { req: { id: string; title?: string; costStars?: number; active?: boolean }; res: RewardDto }
  'rewards:delete': { req: { id: string }; res: void }
  'rewards:redeem': { req: { rewardId: string; personId: string }; res: RedemptionDto }
  'rewards:redemptions': { req: void; res: RedemptionDto[] }
  'rewards:grant': { req: { redemptionId: string }; res: void }

  'camera:list': { req: void; res: { id: string; name: string }[] }
  'camera:add': { req: { name: string; url: string }; res: { id: string; name: string } }
  'camera:remove': { req: { cameraId: string }; res: void }
  /** Start (or join) the stream; returns the playable URL and a per-viewer session id. */
  'camera:start': { req: { cameraId: string }; res: { wsUrl: string; sessionId: string } }
  /** Stop must present the session id from start — stale stops can't kill newer streams. */
  'camera:stop': { req: { sessionId: string }; res: void }

  'rss:getFeed': {
    req: { feedId: string }
    res: {
      feedId: string
      label: string
      items: { title: string; link: string | null; publishedAt: string | null }[]
      fetchedAt: string
    }
  }

  'birdnet:getDetections': {
    req: { url: string }
    res: {
      /** normalized origin the tile should persist */
      url: string
      label: string
      detections: {
        id: number
        commonName: string
        scientificName: string
        confidence: number
        timestamp: string
        /** osl-bird:// proxy URL for the species photo */
        image: string
      }[]
      fetchedAt: string
    }
  }

  'weather:get': {
    req: void
    res: {
      temperature: number
      code: number
      isDay: boolean
      unit: 'f' | 'c'
      label: string
      daily: { date: string; code: number; high: number; low: number; precipProb: number | null }[]
      alerts: WeatherAlert[]
      fetchedAt: string
    } | null
  }
  'weather:searchCity': { req: { query: string }; res: { label: string; lat: number; lon: number }[] }

  'backup:status': { req: void; res: BackupStatus }
  'backup:now': { req: void; res: BackupStatus }
  'backup:pickFolder': { req: void; res: BackupStatus }
  'backup:clearFolder': { req: void; res: BackupStatus }
  /** replaces all data with a backup and restarts the app */
  'backup:restore': { req: { name: string }; res: void }
  'screensaver:pickFolder': { req: void; res: { folder: string | null } }
  'screensaver:listPhotos': { req: void; res: string[] }
  'kiosk:previewScreensaver': { req: void; res: void }
  'kiosk:wake': { req: void; res: void }

  'companion:getStatus': {
    req: void
    res: { running: boolean; port: number; urls: string[]; pairedCount: number; lastError: string | null }
  }
  /** Mints a fresh pairing token (parent-gated); the token only ever lives in the URL fragment. */
  'companion:issueToken': { req: void; res: { url: string } }
  'companion:unpairAll': { req: void; res: void }

  'auth:getStatus': { req: void; res: { pinSet: boolean; unlocked: boolean } }
  'auth:verifyPin': { req: { pin: string }; res: { valid: boolean } }
  'auth:setPin': { req: { pin: string | null }; res: void }
  'auth:lock': { req: void; res: void }

  'sync:now': { req: void; res: void }
  'sync:getStatus': {
    req: void
    res: {
      state: 'idle' | 'syncing' | 'error'
      lastError: string | null
      calendars: {
        id: string
        name: string
        provider: string
        lastSyncedAt: string | null
        syncError: string | null
      }[]
    }
  }
}

export type IpcChannel = keyof IpcContract
export type IpcReq<K extends IpcChannel> = IpcContract[K]['req']
export type IpcRes<K extends IpcChannel> = IpcContract[K]['res']

/** Channel prefixes the preload bridge will allow through. */
export const ALLOWED_CHANNEL_PREFIXES = [
  'app:',
  'settings:',
  'people:',
  'calendars:',
  'events:',
  'google:',
  'ics:',
  'sync:',
  'weather:',
  'auth:',
  'chores:',
  'stars:',
  'rewards:',
  'lists:',
  'listItems:',
  'meals:',
  'notes:',
  'countdowns:',
  'screensaver:',
  'backup:',
  'kiosk:',
  'rss:',
  'camera:',
  'companion:',
  'birdnet:'
] as const

/** Envelope used for every invoke result so errors cross the bridge cleanly. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
