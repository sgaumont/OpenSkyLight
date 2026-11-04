export type PersonRole = 'parent' | 'child'

export interface PersonDto {
  id: string
  name: string
  color: string
  role: PersonRole
  sortOrder: number
}

export interface PersonCreateInput {
  name: string
  color: string
  role: PersonRole
}

export interface PersonUpdateInput {
  id: string
  name?: string
  color?: string
  role?: PersonRole
  sortOrder?: number
}

export type CalendarProvider = 'local' | 'google' | 'ics'

export interface CalendarDto {
  id: string
  provider: CalendarProvider
  name: string
  color: string
  readOnly: boolean
  visible: boolean
}

export interface CalendarCreateInput {
  name: string
  color: string
}

export interface CalendarUpdateInput {
  id: string
  name?: string
  color?: string
  visible?: boolean
}

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'

/** Simplified recurrence model used by the UI; converted to/from RRULE strings. */
export interface RecurrenceInput {
  freq: RecurrenceFreq
  interval?: number
  /** 0 = Monday ... 6 = Sunday (rrule convention) */
  byWeekdays?: number[]
  /** ISO date (inclusive last day the rule applies) */
  untilDate?: string
  count?: number
}

export type EventStatus = 'confirmed' | 'cancelled'

export interface EventDto {
  id: string
  calendarId: string
  title: string
  description: string | null
  location: string | null
  /** UTC ISO instant */
  startAt: string
  endAt: string
  /** IANA zone the event was created in */
  tz: string
  allDay: boolean
  rrule: string | null
  recurrence: RecurrenceInput | null
  recurringEventId: string | null
  originalStartAt: string | null
  status: EventStatus
  readOnly: boolean
  personIds: string[]
}

export interface OccurrenceDto {
  /** Unique per occurrence: `${eventId}|${occurrenceStart}` */
  key: string
  /** Row that holds this occurrence's data (exception row id if overridden) */
  eventId: string
  /** Master series row id (= eventId when not an exception) */
  masterId: string
  calendarId: string
  title: string
  location: string | null
  /** UTC ISO instants */
  start: string
  end: string
  allDay: boolean
  isRecurring: boolean
  readOnly: boolean
  /** Original (pre-override) start; the key used for `this`/`following` edits */
  occurrenceStart: string
  personIds: string[]
}

export interface EventPatch {
  title?: string
  description?: string | null
  location?: string | null
  start?: string
  end?: string
  tz?: string
  allDay?: boolean
  personIds?: string[]
  /** undefined = leave unchanged; null = remove recurrence */
  recurrence?: RecurrenceInput | null
}

export interface EventCreateInput {
  calendarId: string
  title: string
  description?: string | null
  location?: string | null
  start: string
  end: string
  tz: string
  allDay: boolean
  personIds: string[]
  recurrence?: RecurrenceInput | null
}

export type EditScope = 'this' | 'following' | 'all'

export interface EventUpdateInput {
  id: string
  scope: EditScope
  /** Required when scope is 'this' or 'following' on a recurring event */
  occurrenceStart?: string
  changes: EventPatch
}

export interface EventDeleteInput {
  id: string
  scope: EditScope
  occurrenceStart?: string
}

export type CalendarViewKind = 'home' | 'day' | 'week' | 'month' | 'agenda' | 'chores' | 'lists'

export type HomeTileType =
  | 'todayEvents'
  | 'weekAgenda'
  | 'weather'
  | 'choresProgress'
  | 'starBalances'
  | 'list'
  | 'meals'
  | 'clock'
  | 'photo'
  | 'news'
  | 'camera'
  | 'birdnet'
  | 'timer'

export interface HomeTileConfig {
  /** 'list' tiles: which list to show */
  listId?: string
  /** 'news' tiles: which preset feed (see shared/rss.ts) */
  feedId?: string
  /** 'camera' tiles: which configured camera to stream */
  cameraId?: string
  /** 'birdnet' tiles: the BirdNET-Go base URL on the LAN */
  birdnetUrl?: string
  /** any tile: text size as a percent of the Home tab's size (absent = 100) */
  textSize?: number
}

export interface CameraDto {
  id: string
  name: string
}

export interface HomeTile {
  id: string
  type: HomeTileType
  /** grid cell coords (0-based) and spans */
  x: number
  y: number
  w: number
  h: number
  config?: HomeTileConfig
}

export type ListKind = 'grocery' | 'todo' | 'custom'

export interface ListItemDto {
  id: string
  text: string
  checked: boolean
  sortOrder: number
}

export interface ListDto {
  id: string
  name: string
  color: string
  kind: ListKind
  items: ListItemDto[]
}

export type MealSlotKind = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export const MEAL_SLOTS: MealSlotKind[] = ['breakfast', 'lunch', 'dinner', 'snack']

export interface MealSlotDto {
  /** YYYY-MM-DD */
  date: string
  slot: MealSlotKind
  text: string
}

export type ChoreRoutine = 'morning' | 'evening' | null
/** 'anyone' = whoever does it first claims it; 'each' = every assignee has to do it */
export type ChoreMode = 'anyone' | 'each'

/** A chore belongs to no one: whoever does it claims it when checking it off. */
export interface ChoreDto {
  id: string
  title: string
  icon: string | null
  starsValue: number
  /** null = one-time chore on anchorDate */
  recurrence: RecurrenceInput | null
  /** YYYY-MM-DD; first day the chore applies (and the only day for one-offs) */
  anchorDate: string
  routine: ChoreRoutine
  active: boolean
  sortOrder: number
  mode: ChoreMode
  /** who has to do an 'each' chore; [] for 'anyone' */
  assignees: string[]
  /** how many times it can be done on each day it's due (per person for 'each'); null = no limit */
  times: number | null
}

export interface ChoreCreateInput {
  title: string
  starsValue: number
  recurrence?: RecurrenceInput | null
  anchorDate?: string
  routine?: ChoreRoutine
  mode?: ChoreMode
  assignees?: string[]
  times?: number | null
}

export interface ChoreUpdateInput {
  id: string
  title?: string
  starsValue?: number
  recurrence?: RecurrenceInput | null
  anchorDate?: string
  routine?: ChoreRoutine
  active?: boolean
  mode?: ChoreMode
  assignees?: string[]
  times?: number | null
}

export interface DayChoreDto {
  choreId: string
  title: string
  icon: string | null
  starsValue: number
  routine: ChoreRoutine
  /** 'anyone': claimed; 'each': every assignee has done it */
  completed: boolean
  /** who claimed an 'anyone' chore; null while it's still to do (and always for 'each') */
  completedBy: string | null
  mode: ChoreMode
  /** 'each': who has to do it (current family members only) */
  assignees: string[]
  /** 'each': who has done it as many times as it takes (once, for no limit) */
  doneBy: string[]
  /** times per person (per chore for 'anyone') on this day; null = no limit */
  times: number | null
  /** who did it each time today, oldest first — a person appears once per time */
  claims: string[]
}

/** A set of chores each assignee must finish on a day to unlock something (e.g. video game time). */
export interface ChecklistDto {
  id: string
  title: string
  assignees: string[]
  /** null = one day only, on anchorDate */
  recurrence: RecurrenceInput | null
  anchorDate: string
  items: { id: string; title: string }[]
}

export interface ChecklistInput {
  title: string
  assignees: string[]
  recurrence: RecurrenceInput | null
  anchorDate?: string
  /** the full item list: an id keeps (and renames) that item, no id adds one, missing ids are removed */
  items: { id?: string; title: string }[]
}

/** locked = items left; pending = all done, waiting for a parent; approved = unlocked */
export type UnlockState = 'locked' | 'pending' | 'approved'

export interface DayChecklistDto {
  checklistId: string
  title: string
  items: DayChoreDto[]
  people: { personId: string; done: number; total: number; unlock: UnlockState }[]
}

export interface PendingUnlockDto {
  checklistId: string
  title: string
  personId: string
  date: string
}

export interface StarBalanceDto {
  personId: string
  balance: number
}

export interface RewardDto {
  id: string
  title: string
  icon: string | null
  costStars: number
  active: boolean
}

export interface RedemptionDto {
  id: string
  rewardId: string
  rewardTitle: string
  personId: string
  starsSpent: number
  redeemedAt: string
  status: 'pending' | 'granted'
}

/** Text sizes as whole percentages (see shared/textSize.ts). */
export interface TextSizeSettings {
  /** the whole app, header included (applied as the window zoom factor) */
  global: number
  /** absolute per-tab overrides; a missing tab follows `global` */
  tabs: Partial<Record<CalendarViewKind, number>>
  /** meal strips under each Week day, as a percent of the Week tab size (absent = 100) */
  weekMeals?: number
}

export interface BackupStatus {
  /** UTC ISO of the last successful backup (local copy) */
  lastAt: string | null
  lastError: string | null
  /** extra folder (USB stick / network share) each backup is also copied to */
  folder: string | null
  folderError: string | null
  /** no successful backup for a few days */
  stale: boolean
  /** local backups, newest first */
  backups: { name: string; takenAt: string; sizeKb: number; beforeRestore: boolean }[]
}

export interface AppSettings {
  /** 0 = Sunday, 1 = Monday */
  weekStartsOn: 0 | 1
  /** Week view: 7 days from the focused date ('rolling'), or the calendar week containing it ('fixed') */
  weekViewStart: 'rolling' | 'fixed'
  defaultView: CalendarViewKind
  timeFormat: '12h' | '24h'
  textSize: TextSizeSettings
  temperatureUnit: 'f' | 'c'
  /** 'auto' = dark from sunset to sunrise (sun times from the weather location) */
  theme: 'light' | 'dark' | 'auto'
  weather: { lat: number; lon: number; label: string } | null
  sleep: { enabled: boolean; start: string; end: string }
  screensaver: { folder: string | null; idleMinutes: number }
  launchOnStartup: boolean
  homeLayout: HomeTile[]
  /** LAN companion web app (phones editing lists/meals/chores) */
  companion: { enabled: boolean; port: number }
}

import { DEFAULT_HOME_LAYOUT } from '../home'

export const DEFAULT_SETTINGS: AppSettings = {
  weekStartsOn: 0,
  weekViewStart: 'rolling',
  defaultView: 'home',
  timeFormat: '12h',
  textSize: { global: 100, tabs: {} },
  temperatureUnit: 'f',
  theme: 'auto',
  weather: null,
  sleep: { enabled: false, start: '21:30', end: '06:30' },
  screensaver: { folder: null, idleMinutes: 10 },
  launchOnStartup: false,
  homeLayout: DEFAULT_HOME_LAYOUT,
  companion: { enabled: false, port: 8420 }
}

/** Touch-friendly person color palette (Skylight-style) */
export const PERSON_COLORS = [
  '#E5484D', // red
  '#F76B15', // orange
  '#FFB224', // amber
  '#46A758', // green
  '#12A594', // teal
  '#0091FF', // blue
  '#6E56CF', // violet
  '#D6409F', // pink
  '#8E4EC6', // purple
  '#00749E' // deep cyan
] as const

export const CALENDAR_COLORS = PERSON_COLORS
