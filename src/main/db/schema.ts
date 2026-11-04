import { sqliteTable, text, integer, blob, index, primaryKey } from 'drizzle-orm/sqlite-core'

/** All timestamps are UTC ISO-8601 strings; calendar dates are YYYY-MM-DD; booleans are 0/1 ints. */

export const people = sqliteTable('people', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  role: text('role', { enum: ['parent', 'child'] }).notNull().default('child'),
  avatarPath: text('avatar_path'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  deletedAt: text('deleted_at')
})

export const googleAccounts = sqliteTable('google_accounts', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  refreshTokenEnc: blob('refresh_token_enc', { mode: 'buffer' }),
  scopes: text('scopes'),
  connectedAt: text('connected_at'),
  lastRefreshError: text('last_refresh_error')
})

export const calendars = sqliteTable('calendars', {
  id: text('id').primaryKey(),
  provider: text('provider', { enum: ['local', 'google', 'ics'] }).notNull().default('local'),
  googleAccountId: text('google_account_id').references(() => googleAccounts.id),
  googleCalendarId: text('google_calendar_id'),
  icsUrl: text('ics_url'),
  name: text('name').notNull(),
  color: text('color').notNull().default('#0091FF'),
  readOnly: integer('read_only', { mode: 'boolean' }).notNull().default(false),
  visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
  syncToken: text('sync_token'),
  icsEtag: text('ics_etag'),
  icsLastModified: text('ics_last_modified'),
  lastSyncedAt: text('last_synced_at'),
  syncError: text('sync_error'),
  deletedAt: text('deleted_at')
})

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    calendarId: text('calendar_id').notNull().references(() => calendars.id),
    providerEventId: text('provider_event_id'),
    etag: text('etag'),
    icalUid: text('ical_uid'),
    title: text('title').notNull().default(''),
    description: text('description'),
    location: text('location'),
    startAt: text('start_at').notNull(),
    endAt: text('end_at').notNull(),
    tz: text('tz').notNull(),
    allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
    rrule: text('rrule'),
    rdates: text('rdates'), // JSON string[]
    exdates: text('exdates'), // JSON string[]
    recurringEventId: text('recurring_event_id'),
    originalStartAt: text('original_start_at'),
    status: text('status', { enum: ['confirmed', 'cancelled'] }).notNull().default('confirmed'),
    dirty: integer('dirty', { mode: 'boolean' }).notNull().default(false),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    remoteUpdatedAt: text('remote_updated_at')
  },
  (t) => [
    index('idx_events_calendar_start').on(t.calendarId, t.startAt),
    index('idx_events_provider').on(t.providerEventId),
    index('idx_events_master').on(t.recurringEventId)
  ]
)

export const eventPeople = sqliteTable(
  'event_people',
  {
    eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' })
  },
  (t) => [primaryKey({ columns: [t.eventId, t.personId] })]
)

export const syncOutbox = sqliteTable('sync_outbox', {
  id: text('id').primaryKey(),
  entity: text('entity').notNull().default('event'),
  entityId: text('entity_id').notNull(),
  op: text('op', { enum: ['create', 'update', 'delete'] }).notNull(),
  payload: text('payload').notNull(), // JSON snapshot
  baseEtag: text('base_etag'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: text('next_attempt_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull()
})

export const choreChecklists = sqliteTable('chore_checklists', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  assignees: text('assignees').notNull().default('[]'), // JSON person ids
  scheduleRrule: text('schedule_rrule'),
  dueDate: text('due_date'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  deletedAt: text('deleted_at')
})

export const chores = sqliteTable('chores', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  icon: text('icon'),
  personId: text('person_id').references(() => people.id),
  starsValue: integer('stars_value').notNull().default(1),
  scheduleRrule: text('schedule_rrule'),
  dueDate: text('due_date'),
  routine: text('routine', { enum: ['morning', 'evening'] }),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  deletedAt: text('deleted_at'),
  /** 'anyone' = first to do it claims it; 'each' = every assignee does it; 'videogames' = like 'each',
   *  but part of the day's Video Games set, which pays a set reward instead of per task */
  mode: text('mode', { enum: ['anyone', 'each', 'videogames'] }).notNull().default('anyone'),
  assignees: text('assignees'), // JSON person ids, for 'each'
  /** set = an item of that checklist (schedule and assignees come from the checklist) */
  checklistId: text('checklist_id').references(() => choreChecklists.id),
  /** times it can be done on each day it's due (per person for 'each'); 0 = no limit */
  times: integer('times').notNull().default(1)
})

export const checklistUnlocks = sqliteTable('checklist_unlocks', {
  id: text('id').primaryKey(),
  checklistId: text('checklist_id').notNull().references(() => choreChecklists.id),
  personId: text('person_id').notNull().references(() => people.id),
  dueDate: text('due_date').notNull(),
  status: text('status', { enum: ['pending', 'approved'] }).notNull().default('pending'),
  unlockedAt: text('unlocked_at').notNull(),
  approvedAt: text('approved_at')
})

/** A person finished every Video Games task due that day (`round` times over); paid on approval. */
export const videoGameRounds = sqliteTable('video_game_rounds', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull(),
  dueDate: text('due_date').notNull(),
  round: integer('round').notNull(),
  stars: integer('stars').notNull(),
  status: text('status', { enum: ['pending', 'approved'] }).notNull().default('pending'),
  completedAt: text('completed_at').notNull(),
  approvedAt: text('approved_at')
})

export const choreCompletions = sqliteTable(
  'chore_completions',
  {
    id: text('id').primaryKey(),
    choreId: text('chore_id').notNull().references(() => chores.id),
    personId: text('person_id').notNull().references(() => people.id),
    dueDate: text('due_date').notNull(),
    completedAt: text('completed_at').notNull(),
    starsAwarded: integer('stars_awarded').notNull().default(0)
  },
  (t) => [index('idx_completions_chore_date').on(t.choreId, t.dueDate)]
)

export const starLedger = sqliteTable('star_ledger', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id),
  delta: integer('delta').notNull(),
  reason: text('reason', { enum: ['chore', 'redemption', 'manual_adjust'] }).notNull(),
  refId: text('ref_id'),
  createdAt: text('created_at').notNull(),
  /** what it was for, as shown in the game time log ("Make bed", "Un-ticked: Make bed", "Used game time") */
  note: text('note')
})

export const rewards = sqliteTable('rewards', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  icon: text('icon'),
  costStars: integer('cost_stars').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  deletedAt: text('deleted_at')
})

export const rewardRedemptions = sqliteTable('reward_redemptions', {
  id: text('id').primaryKey(),
  rewardId: text('reward_id').notNull().references(() => rewards.id),
  personId: text('person_id').notNull().references(() => people.id),
  starsSpent: integer('stars_spent').notNull(),
  redeemedAt: text('redeemed_at').notNull(),
  status: text('status', { enum: ['pending', 'granted'] }).notNull().default('pending')
})

export const lists = sqliteTable('lists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#0091FF'),
  kind: text('kind', { enum: ['grocery', 'todo', 'custom'] }).notNull().default('custom'),
  sortOrder: integer('sort_order').notNull().default(0),
  deletedAt: text('deleted_at')
})

export const listItems = sqliteTable('list_items', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull().references(() => lists.id),
  text: text('text').notNull(),
  checked: integer('checked', { mode: 'boolean' }).notNull().default(false),
  checkedAt: text('checked_at'),
  personId: text('person_id').references(() => people.id),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull()
})

export const recipes = sqliteTable('recipes', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  ingredients: text('ingredients'), // JSON string[]
  instructions: text('instructions'),
  imagePath: text('image_path'),
  tags: text('tags'), // JSON string[]
  createdAt: text('created_at').notNull(),
  deletedAt: text('deleted_at')
})

export const mealSlots = sqliteTable(
  'meal_slots',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    slot: text('slot', { enum: ['breakfast', 'lunch', 'dinner', 'snack'] }).notNull(),
    recipeId: text('recipe_id').references(() => recipes.id),
    freeText: text('free_text')
  },
  (t) => [index('idx_meal_slots_date').on(t.date)]
)

export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    text: text('text').notNull(),
    authorId: text('author_id'),
    createdAt: text('created_at').notNull(),
    /** UTC ISO; set for "until tonight" notes (end of the posting day) */
    expiresAt: text('expires_at'),
    doneAt: text('done_at')
  },
  (t) => [index('idx_notes_open').on(t.doneAt)]
)

/** A date the family is counting down to ("5 days until Christmas"). */
export const countdowns = sqliteTable('countdowns', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  emoji: text('emoji'),
  /** ISO date */
  date: text('date').notNull(),
  createdAt: text('created_at').notNull(),
  deletedAt: text('deleted_at')
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull() // JSON
})
