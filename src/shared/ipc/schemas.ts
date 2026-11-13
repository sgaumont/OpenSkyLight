import { z } from 'zod'
import { TEXT_SIZE_MAX, TEXT_SIZE_MIN } from '../textSize'
import { HOME_COLS, HOME_ROWS } from '../home'

const isoInstant = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid ISO datetime')
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid ISO date')
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'invalid color')
const id = z.string().min(1)

export const personCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: hexColor,
  role: z.enum(['parent', 'child'])
})

export const personUpdateSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60).optional(),
  color: hexColor.optional(),
  role: z.enum(['parent', 'child']).optional(),
  sortOrder: z.number().int().optional()
})

export const calendarCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: hexColor
})

export const calendarUpdateSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80).optional(),
  color: hexColor.optional(),
  visible: z.boolean().optional(),
  arriveOffsetMinutes: z.number().int().min(0).max(240).optional()
})

export const recurrenceSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(99).optional(),
  byWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  untilDate: isoDate.optional(),
  count: z.number().int().min(1).max(999).optional()
})

export const eventCreateSchema = z.object({
  calendarId: id,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullish(),
  location: z.string().max(300).nullish(),
  start: isoInstant,
  end: isoInstant,
  tz: z.string().min(1),
  allDay: z.boolean(),
  personIds: z.array(id).max(20),
  recurrence: recurrenceSchema.nullish()
})

export const eventPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  start: isoInstant.optional(),
  end: isoInstant.optional(),
  tz: z.string().min(1).optional(),
  allDay: z.boolean().optional(),
  personIds: z.array(id).max(20).optional(),
  recurrence: recurrenceSchema.nullable().optional()
})

export const eventUpdateSchema = z.object({
  id,
  scope: z.enum(['this', 'following', 'all']),
  occurrenceStart: isoInstant.optional(),
  changes: eventPatchSchema
})

export const eventDeleteSchema = z.object({
  id,
  scope: z.enum(['this', 'following', 'all']),
  occurrenceStart: isoInstant.optional()
})

export const occurrenceQuerySchema = z.object({
  start: isoInstant,
  end: isoInstant
})

const textSizePct = z.number().int().min(TEXT_SIZE_MIN).max(TEXT_SIZE_MAX)
const viewKind = z.enum(['home', 'day', 'week', 'month', 'agenda', 'chores', 'lists', 'chats', 'shop'])

const homeTileSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum([
    'todayEvents',
    'weekAgenda',
    'weather',
    'choresProgress',
    'starBalances',
    'list',
    'meals',
    'clock',
    'photo',
    'news',
    'camera',
    'birdnet',
    'timer',
    'countdowns'
  ]),
  x: z.number().int().min(0).max(HOME_COLS - 1),
  y: z.number().int().min(0).max(HOME_ROWS - 1),
  w: z.number().int().min(1).max(HOME_COLS),
  h: z.number().int().min(1).max(HOME_ROWS),
  // value bounds must be >= what sanitizeLayout keeps (1..200), or a renderable
  // layout could be unsaveable
  config: z
    .object({
      listId: z.string().min(1).max(200).optional(),
      feedId: z.string().min(1).max(200).optional(),
      cameraId: z.string().min(1).max(200).optional(),
      birdnetUrl: z.string().min(1).max(200).optional(),
      textSize: textSizePct.optional()
    })
    .optional()
})

export const rssFeedSchema = z.object({ feedId: z.string().min(1).max(40) })

export const birdnetUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .max(500)
    .regex(/^https?:\/\/.+/i, 'Must be an http:// or https:// URL')
})

export const cameraAddSchema = z.object({
  name: z.string().trim().min(1).max(60),
  url: z
    .string()
    .trim()
    .max(500)
    .regex(/^rtsps?:\/\/.+/i, 'Must be an rtsp:// or rtsps:// URL')
})

export const cameraIdSchema = z.object({ cameraId: id })
export const cameraSessionSchema = z.object({ sessionId: id })

export const settingsPatchSchema = z.object({
  patch: z
    .object({
      weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
      weekViewStart: z.enum(['rolling', 'fixed']).optional(),
      defaultView: viewKind.optional(),
      homeLayout: z.array(homeTileSchema).max(24).optional(),
      timeFormat: z.enum(['12h', '24h']).optional(),
      textSize: z
        .object({ global: textSizePct, tabs: z.record(viewKind, textSizePct), weekMeals: textSizePct.optional() })
        .optional(),
      temperatureUnit: z.enum(['f', 'c']).optional(),
      theme: z.enum(['light', 'dark', 'auto']).optional(),
      weather: z.object({ lat: z.number(), lon: z.number(), label: z.string() }).nullable().optional(),
      sleep: z.object({ enabled: z.boolean(), start: z.string(), end: z.string() }).optional(),
      screensaver: z.object({ folder: z.string().nullable(), idleMinutes: z.number().int().min(1).max(120) }).optional(),
      launchOnStartup: z.boolean().optional(),
      companion: z.object({ enabled: z.boolean(), port: z.number().int().min(1024).max(65535) }).optional(),
      travel: z
        .object({ enabled: z.boolean(), homeAddress: z.string().trim().max(200), bufferMinutes: z.number().int().min(0).max(60) })
        .optional(),
      // (a pantsMinC from before v0.8.176, when there was a jacket below pants, is dropped)
      clothing: z.object({ enabled: z.boolean(), shortsMinC: z.number().min(-60).max(60) }).optional()
    })
    .strict()
})

export const idSchema = z.object({ id })
export const voidSchema = z.void().or(z.undefined()).or(z.null())

export const googleCredentialsSchema = z.object({
  clientId: z.string().trim().min(10),
  clientSecret: z.string().trim().min(5)
})

export const accountIdSchema = z.object({ accountId: id })

export const googleCalendarSelectSchema = z.object({
  accountId: id,
  googleCalendarId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  color: hexColor,
  readOnly: z.boolean(),
  selected: z.boolean()
})

export const icsAddSchema = z.object({
  url: z.string().trim().url().max(2000),
  name: z.string().trim().min(1).max(80),
  color: hexColor
})

const routine = z.enum(['morning', 'evening']).nullable()
const choreMode = z.enum(['anyone', 'each', 'videogames'])
const assignees = z.array(id).max(20)

/** times a chore can be done on a day it's due; null = no limit */
const choreTimes = z.number().int().min(1).max(10).nullable()

export const choreCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  starsValue: z.number().int().min(0).max(99),
  coinsValue: z.number().int().min(0).max(99).optional(),
  recurrence: recurrenceSchema.nullish(),
  anchorDate: isoDate.optional(),
  routine: routine.optional(),
  mode: choreMode.optional(),
  assignees: assignees.optional(),
  times: choreTimes.optional()
})

export const choreUpdateSchema = z.object({
  id,
  title: z.string().trim().min(1).max(120).optional(),
  starsValue: z.number().int().min(0).max(99).optional(),
  coinsValue: z.number().int().min(0).max(99).optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  anchorDate: isoDate.optional(),
  routine: routine.optional(),
  active: z.boolean().optional(),
  mode: choreMode.optional(),
  assignees: assignees.optional(),
  times: choreTimes.optional()
})

export const choreDaySchema = z.object({ date: isoDate })
export const choreCheckSchema = z.object({ choreId: id, date: isoDate })
export const choreCompleteSchema = choreCheckSchema.extend({ personId: id })
/** personId says whose tick to remove on an 'each' chore; ignored for 'anyone' */
export const choreUncompleteSchema = choreCheckSchema.extend({ personId: id.optional() })

const checklistFields = {
  title: z.string().trim().min(1).max(120),
  assignees: assignees.min(1),
  recurrence: recurrenceSchema.nullable(),
  anchorDate: isoDate.optional(),
  items: z.array(z.object({ id: id.optional(), title: z.string().trim().min(1).max(120) })).min(1).max(20)
}
export const checklistCreateSchema = z.object(checklistFields)
export const checklistUpdateSchema = z.object({ id, ...checklistFields })
export const unlockApproveSchema = z.object({ checklistId: id, personId: id, date: isoDate, round: z.number().int().min(1).max(99).optional() })
export const videoGamesStarsSchema = z.object({ stars: z.number().int().min(0).max(999) })

const rewardKind = z.enum(['static', 'dynamic'])
const currency = z.enum(['stars', 'coins'])
const bonusMinutes = z.number().int().min(0).max(240)
const rewardIcon = z.string().trim().max(16).nullable()

export const rewardCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  costStars: z.number().int().min(1).max(9999),
  kind: rewardKind.optional(),
  bonusMinutes: bonusMinutes.optional(),
  icon: rewardIcon.optional(),
  currency: currency.optional()
})

export const rewardUpdateSchema = z.object({
  id,
  title: z.string().trim().min(1).max(120).optional(),
  costStars: z.number().int().min(1).max(9999).optional(),
  active: z.boolean().optional(),
  kind: rewardKind.optional(),
  bonusMinutes: bonusMinutes.optional(),
  icon: rewardIcon.optional(),
  currency: currency.optional()
})

export const redeemSchema = z.object({ rewardId: id, personId: id, stars: z.number().int().min(1).max(100_000).optional() })
export const starsAdjustSchema = z.object({ personId: id, delta: z.number().int().min(-10_000).max(10_000), currency: currency.optional() })
export const useTimeSchema = z.object({ personId: id, stars: z.number().int().min(1).max(100_000).optional(), rewardId: id.optional() })
export const stopTimerSchema = z.object({ id })
export const adjustTimerSchema = z.object({ id, minutes: z.number().int().min(-600).max(600).refine((n) => n !== 0) })
export const gameTimeLogSchema = z.object({ personId: id.nullable(), limit: z.number().int().min(1).max(5000) })
export const grantSchema = z.object({ redemptionId: id })

export const listCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: hexColor,
  kind: z.enum(['grocery', 'todo', 'custom'])
})

export const listUpdateSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80).optional(),
  color: hexColor.optional()
})

export const listItemAddSchema = z.object({ listId: id, text: z.string().trim().min(1).max(300) })
export const listIdSchema = z.object({ listId: id })

export const mealsRangeSchema = z.object({ start: isoDate, end: isoDate })
export const noteAddSchema = z.object({
  text: z.string().trim().min(1).max(280),
  authorId: z.string().min(1).nullable(),
  untilTonight: z.boolean()
})
export const noteDoneSchema = z.object({ id: z.string().min(1) })
export const noteReplySchema = z.object({
  noteId: z.string().min(1),
  text: z.string().trim().min(1).max(280),
  authorId: z.string().min(1).nullable()
})
export const noteKioskReplySchema = z.object({ noteId: z.string().min(1), text: z.string().trim().min(1).max(280) })
export const chatSendSchema = z.object({
  text: z.string().trim().min(1).max(280),
  authorId: z.string().min(1).nullable().optional(),
  ring: z.boolean().optional(),
  deviceName: z.string().trim().max(40).nullable().optional(),
  endpoint: z.string().url().max(1000).nullable().optional()
})
export const chatKioskSendSchema = z.object({ text: z.string().trim().min(1).max(280) })
export const noteKioskAddSchema = z.object({ text: z.string().trim().min(1).max(280), untilTonight: z.boolean() })
export const countdownSchema = z.object({
  title: z.string().trim().min(1).max(60),
  emoji: z.string().max(8).nullable(),
  date: isoDate
})
export const countdownUpdateSchema = countdownSchema.extend({ id: z.string().min(1) })
export const countdownDeleteSchema = z.object({ id: z.string().min(1) })

export const mealSetSchema = z.object({
  date: isoDate,
  slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  text: z.string().trim().max(200).nullable()
})

export const backupRestoreSchema = z.object({
  name: z.string().regex(/^(openskylight-\d{4}-\d{2}-\d{2}|before-restore-\d{4}-\d{2}-\d{2}-\d{6})\.db$/)
})

export const travelKeySchema = z.object({ apiKey: z.string().trim().min(20).max(200).nullable() })
const pushEndpoint = z.string().url().max(1000)
export const notifyEndpointSchema = z.object({ endpoint: pushEndpoint })
const pushPrefs = z.object({ chat: z.boolean(), leave: z.boolean(), approvals: z.boolean(), weather: z.boolean(), timers: z.boolean() })
export const notifySubscribeSchema = z.object({
  endpoint: pushEndpoint,
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(100),
  personId: z.string().min(1).nullable(),
  prefs: pushPrefs
})
export const notifyPhoneSchema = z.object({ id: z.string().min(1).max(100) })
export const notifySubscribeFcmSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_:.-]{20,400}$/),
  personId: z.string().min(1).nullable(),
  prefs: pushPrefs,
  deviceName: z.string().trim().max(40).nullable().optional()
})
export const travelTestSchema = z.object({ destination: z.string().trim().min(3).max(300) })

export const citySearchSchema = z.object({ query: z.string().trim().min(2).max(80) })

export const pinVerifySchema = z.object({ pin: z.string().regex(/^\d{4,8}$/) })

export const pinSetSchema = z.object({ pin: z.string().regex(/^\d{4,8}$/).nullable() })
