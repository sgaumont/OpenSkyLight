import type DatabaseType from 'better-sqlite3'

/**
 * Hand-rolled migrations driven by PRAGMA user_version so the SQL ships inside the
 * bundled main process (no migration folder to package). Append new entries only —
 * never edit an existing one once released.
 */
const MIGRATIONS: string[] = [
  // 001 — initial schema
  `
  CREATE TABLE people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'child',
    avatar_path TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE google_accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    refresh_token_enc BLOB,
    scopes TEXT,
    connected_at TEXT,
    last_refresh_error TEXT
  );

  CREATE TABLE calendars (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'local',
    google_account_id TEXT REFERENCES google_accounts(id),
    google_calendar_id TEXT,
    ics_url TEXT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#0091FF',
    read_only INTEGER NOT NULL DEFAULT 0,
    visible INTEGER NOT NULL DEFAULT 1,
    sync_token TEXT,
    ics_etag TEXT,
    ics_last_modified TEXT,
    last_synced_at TEXT,
    sync_error TEXT,
    deleted_at TEXT
  );

  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES calendars(id),
    provider_event_id TEXT,
    etag TEXT,
    ical_uid TEXT,
    title TEXT NOT NULL DEFAULT '',
    description TEXT,
    location TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    tz TEXT NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    rrule TEXT,
    rdates TEXT,
    exdates TEXT,
    recurring_event_id TEXT,
    original_start_at TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed',
    dirty INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    remote_updated_at TEXT
  );
  CREATE INDEX idx_events_calendar_start ON events(calendar_id, start_at);
  CREATE INDEX idx_events_provider ON events(provider_event_id);
  CREATE INDEX idx_events_master ON events(recurring_event_id);

  CREATE TABLE event_people (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, person_id)
  );

  CREATE TABLE sync_outbox (
    id TEXT PRIMARY KEY,
    entity TEXT NOT NULL DEFAULT 'event',
    entity_id TEXT NOT NULL,
    op TEXT NOT NULL,
    payload TEXT NOT NULL,
    base_etag TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE chores (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    icon TEXT,
    person_id TEXT REFERENCES people(id),
    stars_value INTEGER NOT NULL DEFAULT 1,
    schedule_rrule TEXT,
    due_date TEXT,
    routine TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE chore_completions (
    id TEXT PRIMARY KEY,
    chore_id TEXT NOT NULL REFERENCES chores(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    due_date TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    stars_awarded INTEGER NOT NULL DEFAULT 0,
    UNIQUE (chore_id, due_date)
  );
  CREATE INDEX idx_completions_chore_date ON chore_completions(chore_id, due_date);

  CREATE TABLE star_ledger (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id),
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE rewards (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    icon TEXT,
    cost_stars INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT
  );

  CREATE TABLE reward_redemptions (
    id TEXT PRIMARY KEY,
    reward_id TEXT NOT NULL REFERENCES rewards(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    stars_spent INTEGER NOT NULL,
    redeemed_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE TABLE lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#0091FF',
    kind TEXT NOT NULL DEFAULT 'custom',
    sort_order INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT
  );

  CREATE TABLE list_items (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lists(id),
    text TEXT NOT NULL,
    checked INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT,
    person_id TEXT REFERENCES people(id),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE recipes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    ingredients TEXT,
    instructions TEXT,
    image_path TEXT,
    tags TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE meal_slots (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    slot TEXT NOT NULL,
    recipe_id TEXT REFERENCES recipes(id),
    free_text TEXT,
    UNIQUE (date, slot)
  );
  CREATE INDEX idx_meal_slots_date ON meal_slots(date);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2: chores everyone must do (mode 'each' + assignees), checklists that unlock a prize per
  // person once a parent signs off, and completions keyed per person (was one per chore per day)
  `
  CREATE TABLE chore_checklists (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    assignees TEXT NOT NULL DEFAULT '[]',
    schedule_rrule TEXT,
    due_date TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );

  ALTER TABLE chores ADD COLUMN mode TEXT NOT NULL DEFAULT 'anyone';
  ALTER TABLE chores ADD COLUMN assignees TEXT;
  ALTER TABLE chores ADD COLUMN checklist_id TEXT REFERENCES chore_checklists(id);

  CREATE TABLE checklist_unlocks (
    id TEXT PRIMARY KEY,
    checklist_id TEXT NOT NULL REFERENCES chore_checklists(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    due_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    unlocked_at TEXT NOT NULL,
    approved_at TEXT,
    UNIQUE (checklist_id, person_id, due_date)
  );

  CREATE TABLE chore_completions_v2 (
    id TEXT PRIMARY KEY,
    chore_id TEXT NOT NULL REFERENCES chores(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    due_date TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    stars_awarded INTEGER NOT NULL DEFAULT 0,
    UNIQUE (chore_id, due_date, person_id)
  );
  INSERT INTO chore_completions_v2 (id, chore_id, person_id, due_date, completed_at, stars_awarded)
    SELECT id, chore_id, person_id, due_date, completed_at, stars_awarded FROM chore_completions;
  DROP TABLE chore_completions;
  ALTER TABLE chore_completions_v2 RENAME TO chore_completions;
  CREATE INDEX idx_completions_chore_date ON chore_completions(chore_id, due_date);
  `,
  // v3: chores that can be done more than once a day — a times cap (0 = no limit), and
  // completions without the one-per-person-per-day rule
  `
  ALTER TABLE chores ADD COLUMN times INTEGER NOT NULL DEFAULT 1;

  CREATE TABLE chore_completions_v3 (
    id TEXT PRIMARY KEY,
    chore_id TEXT NOT NULL REFERENCES chores(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    due_date TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    stars_awarded INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO chore_completions_v3 (id, chore_id, person_id, due_date, completed_at, stars_awarded)
    SELECT id, chore_id, person_id, due_date, completed_at, stars_awarded FROM chore_completions;
  DROP TABLE chore_completions;
  ALTER TABLE chore_completions_v3 RENAME TO chore_completions;
  CREATE INDEX idx_completions_chore_date ON chore_completions(chore_id, due_date);
  `,
  // v4: family notes — short messages posted from a phone that stay on the kiosk until someone
  // marks them done (or, for "until tonight", until midnight). author_id is a plain id, not a
  // foreign key, so removing a family member never blocks or breaks their old notes.
  `
  CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    author_id TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    done_at TEXT
  );
  CREATE INDEX idx_notes_open ON notes(done_at);
  `,
  // v5: "Video Games" chores — a set of 'each'-style tasks that pays a set reward (not per task)
  // each time a person finishes the whole day's set, once a parent signs off. One row per round.
  `
  CREATE TABLE video_game_rounds (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    due_date TEXT NOT NULL,
    round INTEGER NOT NULL,
    stars INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    completed_at TEXT NOT NULL,
    approved_at TEXT,
    UNIQUE (person_id, due_date, round)
  );
  `,
  // v6: a game time log — each balance change says what it was for (chore titles outlive the
  // chore history, which only keeps a few days). Older rows have no note; the log works one out.
  `
  ALTER TABLE star_ledger ADD COLUMN note TEXT;
  `,
  // v7: countdowns — "5 days until Christmas" — added in Settings or on the phone
  `
  CREATE TABLE countdowns (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    emoji TEXT,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );
  `,
  // v8: note replies — a note becomes a short conversation between the tablet and the phones.
  // from_kiosk marks replies typed or tapped on the tablet; note_id is a plain id like author_id.
  `
  CREATE TABLE note_replies (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    text TEXT NOT NULL,
    author_id TEXT,
    from_kiosk INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_note_replies_note ON note_replies(note_id, created_at);
  `,
  // v9: per-calendar arrival offset — events show "Arrive by" this many minutes before they start
  `
  ALTER TABLE calendars ADD COLUMN arrive_offset_min INTEGER NOT NULL DEFAULT 0;
  `
]

/** `upTo` stops at that version — for tests that upgrade a database from an older schema. */
export function runMigrations(sqlite: DatabaseType.Database, upTo = MIGRATIONS.length): void {
  const current = sqlite.pragma('user_version', { simple: true }) as number
  for (let v = current; v < upTo; v++) {
    sqlite.transaction(() => {
      sqlite.exec(MIGRATIONS[v])
      sqlite.pragma(`user_version = ${v + 1}`)
    })()
  }
}
