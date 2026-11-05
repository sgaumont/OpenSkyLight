# CLAUDE.md — sgaumont's OpenSkyLight fork

Personal fork of [lowerygt/OpenSkyLight](https://github.com/lowerygt/OpenSkyLight)
(Electron 34 + React 19 + TypeScript family calendar kiosk), maintained to ship
my own changes to one wall kiosk while staying mergeable with upstream.

- `origin`   → https://github.com/sgaumont/OpenSkyLight (my fork, publishes releases)
- `upstream` → https://github.com/lowerygt/OpenSkyLight (pull new upstream work from here)

## Goals

- Run my own improvements on my kiosk, delivered through the app's normal
  GitHub-Releases auto-update.
- Keep changes small and upstream-friendly so `git merge upstream/main` stays easy.
- Never lose kiosk data or the Google Calendar connection when upgrading.

## Hard rules

- **Never change the app name, `productName`, or `appId`** (`electron-builder.yml`:
  `appId: com.openskylight.app`, `productName: OpenSkyLight`; `package.json`
  `name: openskylight`). The kiosk's data lives in `%APPDATA%\OpenSkyLight`
  (Electron `userData`, derived from productName): `openskylight.db` plus
  Chromium's `Local State`, which holds the DPAPI-wrapped key that `safeStorage`
  uses to encrypt the Google refresh token and client secret. A rename means a
  new data folder → empty calendar and a broken Google connection.
- Explain each step briefly; **ask before anything destructive** (force pushes,
  deleting branches/tags/releases, touching kiosk data, history rewrites).
- Do feature work on a branch; keep `npm test` and `npm run typecheck` passing.
- Release versions must sort above upstream's latest (upstream was at v0.8.0 when
  this fork was created), or electron-updater won't offer them.

## Kiosk

- Device: Microsoft Surface Pro (~10" screen), Windows 10, touch-only wall display.
  Screen 2160×1440 at 150% Windows scaling → app viewport **1440×960** (test UI at this size).
  I develop on a 55" screen, so sizes/layout/fonts can only be judged on the device.
- **Every change gets tested on the Surface before release:** build the portable
  exe (`npm run dist` → `dist\OpenSkyLight <ver>.exe`), I run it on the device
  (fully quit the running copy first — single-instance lock), and nothing is
  released until I approve.
- Runs the **portable exe**, deliberately — I deploy by copying it over myself.
  Its autorun points at a file named **`OpenSkyLight 0.8.0.exe`**, so that name
  never changes: `npm run dist` triggers `postdist` (`scripts/copy-kiosk-exe.mjs`),
  which renames the portable build to `dist\OpenSkyLight 0.8.0.exe` (overwriting
  the previous one) and deletes older versions' installers. That file is the one
  to copy to the Surface, whatever the real app version is.
- The updater is disabled in portable builds (`PORTABLE_EXECUTABLE_FILE` check in
  `src/main/updater.ts`); otherwise electron-updater would silently install the
  Setup version at 03:30. Keep that check when merging upstream.
- Setup and portable share `%APPDATA%\OpenSkyLight`, so switching keeps all data.
- After my first fork release is installed over the top, its `app-update.yml`
  points at `sgaumont/OpenSkyLight`, so the kiosk follows my releases, not upstream's.

## Dev environment notes (this PC)

- Node 24 / npm 11.16 blocks dependency install scripts by default
  (`allow-scripts`). The project's own `postinstall`
  (`electron-builder install-app-deps`) still builds `better-sqlite3`, but the
  Electron binary must be installed by hand if `node_modules\electron\dist\electron.exe`
  is missing. `node node_modules\electron\install.js` exits silently without
  extracting on this machine, so extract the cached zip from
  `%LOCALAPPDATA%\electron\Cache\*\electron-v<ver>-win32-x64.zip` into
  `node_modules\electron\dist` with `tar -xf`, then write `path.txt` containing
  `electron.exe` (no newline).
- Tests run inside Electron's Node (`scripts/run-vitest.mjs`, `ELECTRON_RUN_AS_NODE`)
  so `better-sqlite3`'s Electron ABI build loads.
- CI (`.github/workflows/release.yml`) uses Node 22 + `npm ci`; it publishes a
  GitHub Release when a `v*` tag is pushed.

## Codebase map (where things live)

- `src/main` — Electron main process: services, SQLite (drizzle), Google/ICS sync,
  kiosk idle/sleep logic (`kiosk/kiosk.ts`), auto-updater (`updater.ts`).
- `src/renderer/src` — React UI. Home tiles: `features/home/tiles.tsx`.
  Calendar views: `features/calendar/*`. Screensaver/sleep overlays:
  `features/kiosk/KioskOverlays.tsx`. Settings UI: `features/settings/SettingsSheet.tsx`.
  Navigation state: `stores/uiStore.ts`; period label/arrows: `features/shell/Header.tsx`.
- `src/shared` — types, settings defaults (`types/index.ts`), zod IPC schemas
  (`ipc/schemas.ts`), date ranges (`dates.ts`).
- `tests/unit` — vitest suites.

## Round 1 changes — shipped in v0.8.1 (branch `feature/round-1`)

A. **Today tile hides finished events.** Drop timed events whose end time has
   passed; keep all-day and in-progress events. Re-evaluate as time passes (no
   restart needed). *Ask before applying this to other views.*
B. **Wake tap doesn't click through.** The tap that dismisses the screensaver or
   sleep overlay must not trigger the UI underneath: consume the event and
   ignore input for ~300 ms after dismissal.
C. **Week view start mode.** New setting: "Rolling (starts today)" vs "Fixed start
   day" (the existing `weekStartsOn`), default **rolling**. Arrows step by a week
   from the rolling start; the header label and meal strip must stay aligned with
   the displayed days.

Add unit tests where sensible.

## Round 2 — v0.8.3 (branch `feature/round-2`)

- **Text sizes** (whole percents 70–200, step 10; math in `src/shared/textSize.ts`):
  - Overall: `settings.textSize.global` → the window zoom factor
    (`kiosk.applyTextSize`, applied on every page load and on change). Scales everything.
  - Per tab: `settings.textSize.tabs[view]` (absolute) → CSS `zoom` on the `<main>`
    content wrapper in `App.tsx`, relative to overall. Header unaffected.
  - Home is special: zooming the grid would break `useHomeGrid`'s pixel math, so
    the Home tab size is applied per tile, times each tile's own
    `config.textSize` (A−/A+ pill on each tile in Home edit mode). Camera/photo
    tiles are excluded (edge-to-edge media, no text).
  - UI: Settings → General → Text size.
- **Scrollable Home tiles:** `TileScroll` in `tiles.tsx` — scrolls when content
  overflows, fades the bottom edge while there's more (scrollbars are hidden).

## v0.8.4 — Home "This week" tile (branch `feature/this-week-tile`)

- Covers the 6 days after today (today has its own tile); rolls over at midnight.
- Shows every event (the tile scrolls) — no more "+N more" trimming.
- Time before the name; the whole tile is one grid, so the time column is as wide
  as the longest entry shown and every name lines up. All-day rows show "All Day"
  in the time column (v0.8.9).

## v0.8.5 — photos + CI (same branch; 0.8.4 was never released)

- Screensaver shuffle: `ShuffleDeck` (`src/shared/shuffleDeck.ts`) deals every
  photo once per pass in random order, reshuffles each pass, never repeats
  back-to-back. The deck lives for the app's lifetime (module scope in
  `KioskOverlays.tsx`), so successive screensaver sessions continue the pass.
- Home photo tile: tap to advance; the 30s timer restarts on every change.
- Release workflow: `actions/checkout@v7`, `actions/setup-node@v7` (Node 24
  runtime; clears GitHub's Node 20 deprecation warning).

## v0.8.6 — sleep tap-to-wake lasts while in use (branch `fix/sleep-wake-while-used`)

- Was: a tap during the sleep window woke the screen for a fixed 5 min (renderer
  timer), then blacked out mid-use; the display power hold also stayed released,
  so Windows could blank the screen on its own.
- Now: main owns it (`kiosk.ts` `wake()`/`updateSleep()`, `stillAwake()` in
  `shared/sleepWindow.ts`): awake until `WAKE_IDLE_SECONDS` (5 min) pass with no
  input (`powerMonitor.getSystemIdleTime`), or the window ends; the display hold
  is re-taken while awake.

## v0.8.7 — Week meals text size (same branch; 0.8.6 not released separately)

- `settings.textSize.weekMeals` (percent of the Week tab size, absent = 100):
  CSS zoom on the meal strip wrapper in `WeekView.tsx` (`weekMealsZoom`).
  Settings → General → Text size → "Week meals" (A−/A+, Reset). Day view's meal
  strip is not affected.

## v0.8.8 — no Day button in the header menu (same branch)

- Removed 'Day' from the header `SegmentedControl` (`Header.tsx`). The Day view
  itself stays: the Home Today tile and tapping a Month date still open it
  (no menu tab is highlighted while it's shown).

## v0.8.10 — meals on the Today tile; Customize pencil in the header (same branch)

- Home Today tile: `TodayMeals` (in `tiles.tsx`) puts the Week view's `MealStrip`
  at the bottom (events scroll above it). Tapping it opens `MealsDialog` via a
  portal (escapes the tile's clipping/zoom); a wrapper stops clicks so the strip
  and dialog don't also trigger the tile's tap (which opens Day view).
- The Home "Customize" pencil moved from a floating bottom-left button (it covered
  that strip) into the header, left of the gear, Home tab only. It bumps
  `uiStore.homeEditRequest`; `HomeView` enters edit mode on change (ignores the
  value seen on mount, and requests while already editing). Same aria-label, so
  `e2e-home` still finds it.

## v0.8.11 — Weather tile = 5-day forecast (same branch)

- `WeatherTile` no longer shows the current temperature (the header has it); it
  fills the tile with the 5 fetched days (today + 4; `forecast_days=5` in
  `weatherService.ts`): day, icon, high/low, rain % when ≥ 20%. Side by side when
  the tile is wide, stacked rows when it's taller than wide; narrow (compact)
  tiles put the low under the high.

## v0.8.12 — lower minimum tile heights (same branch)

- `TILE_SPECS.minH` in `src/shared/home.ts` (grid is 12×6; one row ≈ 106–120px on
  the Surface). Scrolling text tiles — This week, List, Chores, Stars, Meals,
  News, Birds — can shrink to 1 row; Today to 2 (room for its meal strip).
  Weather, Clock, Photo, Camera, Timer stay at 2 (they don't scroll).
  Pinned by tests in `tests/unit/homeLayout.test.ts`.

## v0.8.13 — weather tile fills its box; 1-row weather (same branch)

- Weather `minH` 1. `WeatherTile` sets `container-type: size` and sizes everything
  with `fit(min, cqh, cqw, max)` (CSS `clamp(min(cqh, cqw))`), so the forecast grows
  with the tile. Layouts: stacked rows (tall), one line per day (1-row, ≥3 wide;
  low hides via `@max-[17rem]` container query when too narrow), columns otherwise
  (low under high in squarish/narrow tiles; a 1-row 2-wide tile shows highs only).
  The rain line is always reserved so columns line up.

## v0.8.14 — finer Home grid, 36×18 (same branch)

- `HOME_GRID_SCALE = 3` in `src/shared/home.ts`: the original 12×6 cells split 3 ways
  (`HOME_COLS`/`HOME_ROWS` = 36/18). Sizes are written as `cells(n)` (n original
  cells), so `TILE_SPECS` and `DEFAULT_HOME_LAYOUT` read as before. With the fixed
  12px gap, 3 fine cells span exactly 1 old cell, so converted layouts are
  pixel-identical. Snap step ≈ 37×39px on a 1368×912 window (was ≈111×118).
- One-time conversion at boot: `migrateHomeGrid()` (settingsService) scales a saved
  layout ×3 and sets internal key `homeGridScale = 3`. **An older exe would misread a
  converted layout** (tiles oversized/shoved) — only the Home arrangement; re-arrange to fix.
- Anything that reasons in cells must use `cells()`/`HOME_GRID_SCALE` (weather tile
  thresholds, `e2e-home.mjs` coordinates, `homeLayout.test.ts`). Pixel checks use
  `grid.spanW/spanH` (gaps included), not `w * cellW`.

## v0.8.15 — proportional tile padding; weather high-over-low (same branch)

- Tile padding is `tilePadding()` in `HomeView.tsx`: ~7% of the tile's shorter side,
  6px–16px × the tile's text size (large tiles keep 16px; 1-row tiles ~9px). Was a
  fixed `p-4` that ate 26–37% of a 1-row tile's height.
- Camera/photo tiles fill edge to edge via `position:absolute; inset:0` (`BLEED` in
  `tiles.tsx`) — the old negative-margin bleed left an 8px gap at the top.
- Meals/Chores/Stars tile lists are top-aligned (were vertically centred).
- Weather columns: high above the day, low below the icon (one value wide per
  column → larger numbers); width caps sized so "-12°" still fits.
- v0.8.18: the one-line weather layout is only for tiles ≤ 1 row (`rows <= 1`); the fine
  grid's in-between heights (1⅓, 1⅔ rows — the kiosk's tile) use columns and fill
  ~80% of the height instead of ~40%. Icon width cap 14 → 17cqw.
- v0.8.20: tile padding halved and equal on all sides — `tilePadding()` = ~3.5% of the
  shorter side, 3–8px × tile text size. Weather columns: items sized to ~80% of the height,
  `justify-between` + `py-[1.5cqh]` spread the rest, so the forecast fills ~97% of the
  height (descenders overflowed by 2px without the inset).
- v0.8.20: the Home Today tile header shows its date, `TODAY (SUN 1)` (same `ccc d` format
  as the This week day labels), so This week reads as its continuation.

## v0.8.16 — Week view wraps names; no Agenda in the menu (branch `feature/week-wrap`)

- `EventCard` takes `wrap`: titles use `overflow-wrap:anywhere` instead of `truncate`
  (all-day too). Only `WeekView` passes it; Day/Agenda keep one-line titles.
- v0.8.17: the Home Today tile wraps event names the same way; its colour bar
  stretches with the name (`self-stretch min-h-7`).
- v0.8.19: the Home This week tile wraps names too; its grid uses `items-baseline` so day,
  dot (inline-block in a text-sized span) and time stay level with a wrapped name's first line.
- Header menu is now Home · Week · Month · Chores · Lists. The Agenda view stays
  reachable from the Home "This week" tile (`navTarget: 'agenda'`), like Day via
  the Today tile / Month dates.

## v0.8.21 — swipe to change month (same branch)

- `useSwipe()` (`src/renderer/src/lib/useSwipe.ts`) on the Month view container: swipe left =
  next month, right = previous (`uiStore.step`). Rule in `swipeStep()` (`src/shared/swipe.ts`,
  tested): ≥60px sideways, ≥2× more horizontal than vertical, ≤800ms. `touch-action: pan-y`;
  the click after a swipe is swallowed so a swipe starting on a date doesn't open that day.
  Reusable for other views (Week, Chores…).
- v0.8.22: the Week view uses it too. touch-action only reaches up to the nearest scroll
  container, so `global.css` applies `pan-y` to everything inside `[data-swipe]` — without
  it, a swipe starting inside a scrolling Week column was claimed by the browser
  (pointercancel).

## v0.8.23 — today's high/low in the header; weather tile starts tomorrow (same branch)

- `WeatherButton` (`features/weather/WeatherHeader.tsx`) shows today's high over low next to the
  current temperature. Forecast fetch is now `forecast_days=6`: the Home weather tile shows
  `daily.slice(1, 6)` (tomorrow + 4, weekday labels); the header's forecast dialog stays today + 4.
- The header already overflowed (45px) at ~1050px layout width (Surface at 130% text, Week tab,
  4 people). Below 1300px it now uses smaller day/clock/temperature and tighter gaps (`max-[1300px]:`).
- v0.8.24: today's high/low 16 → 20px. To make room on narrow layouts (`max-[1300px]`, i.e. the
  kiosk at 115%+ text): round header buttons 52 → 44px, avatars 44 → 40px, menu items px-2 → px-1.5.
  Verified at the kiosk's real 1440×960 viewport incl. the widest date (Wed Dec 30 12:59 pm,
  `Dec 30 – Jan 5`) with 4 people — fits at 100/115/130% (0px spare in that worst case at 130%).
- v0.8.25: the header high/low stack is right-aligned (`items-end`).
- v0.8.26: clock and current temperature enlarged to the limits of the existing header height and
  width (measured at 1440×960, widest date, 4 people): clock 52.8→56px @100% (layout ≥1300),
  26→50px @115% (1150–1300), 26→34px @130% (<1150); temperature 30→48 / 24→40 / 24→30px; icon
  34→48 / 28→40 / 28→34px. <1150 frees width via tighter avatar overlap (4+ people), menu px-1 and
  header gap-1. Header heights unchanged (97/90/90px). Temperature at 100% is capped at 48px by height
  (button padding + glyph must stay ≤ the 61px date block).
- v0.8.27: the kiosk always runs **100% text** (layout 1440px), so the 100% bucket is maxed: clock 60px
  (= date-block height), weather button py-0.5 (py-1.5 below 1300px) so temperature and icon reach 56px.
  Worst case (widest date, Week, 4 people) still fits with 12px spare; header height unchanged (97px).
- v0.8.28: the screensaver shows the header's weather bottom-right (`ScreensaverWeather` in
  `KioskOverlays.tsx`): icon, current temperature, today's high over low, white + drop-shadow like its
  clock, same 48px margin, centred on the clock digits. Hidden when no weather location is set.
- v0.8.29: the sleep screen shows the same weather (`SleepWeather`), as faint as its clock (white/15),
  on the clock's line just left of it (icon 24px, temp text-xl, high/low 11px stacked).
- v0.8.30 moved both next to the time; the user didn't like it — **reverted in v0.8.31** (layout as v0.8.29).
- v0.8.32: **chores belong to no one.** A chore is just something that needs doing; whoever does it
  claims it when checking it off ("Who did it?" picker), and the completion + stars go to them
  (`chores:complete` now takes `personId`; `DayChoreDto.completedBy` replaces `personId`; `ChoreDto`/create/
  update inputs have no person). Un-ticking takes the stars back from the claimant; a second claim on an
  already-done chore doesn't steal it. `chores.person_id` is legacy and ignored (no migration — old
  assigned chores simply become shared). Chores view = one list grouped Morning/Anytime/Evening + a family
  panel (done today, stars); home "Chores today" tile = one shared progress bar + who claimed how many;
  Settings chore editor and the phone companion lost their "Who" pickers (companion claims inline).
- v0.8.33: home "Chores today" tile lists **every** chore (to-do = empty circle; done = ticked in the
  claimer's colour + their initial) under the shared progress bar. Startup can no longer fail invisibly:
  a boot error shows a dialog and appends to `userData/startup-error.log` (after startup, stray errors are
  only logged); a window that isn't ready after 15s is shown anyway with DevTools. (On the Surface a
  "running but no window" was a leftover instance holding the single-instance lock — end it in Task Manager.)
- v0.8.34: tapping a chore on the home tile claims it in place — the same "Who did it?" popup as the
  Chores tab (shared `useChoreClaim` + `Avatar` in `features/chores/ClaimChore.tsx`); a done one is
  un-ticked. Rows are `role="button"` divs (the tile is itself a button) that stop propagation; the dialog
  is portalled to body (escapes the tile's zoom) inside a stopPropagation wrapper. Tapping the tile outside a
  chore still opens Chores. While arranging Home, tile content is `pointer-events-none` (no claims or photo
  advances mid-drag).
- v0.8.35: sleep (black, overnight) overlay's bottom-right time + weather are twice as big (40px text,
  48px icon, 22px high/low); still faint `text-white/15`.
- v0.8.36: …and 50% bigger again (3× the original: 60px text, 72px icon, 33px high/low).
- v0.8.37: **"Everyone" chores + checklists.** DB migration v2 (`migrations.ts`, first one after the
  initial schema): `chores.mode` ('anyone' | 'each') + `chores.assignees` (JSON ids) + `chores.checklist_id`;
  new `chore_checklists` (title = the prize, assignees, schedule) and `checklist_unlocks` (per checklist +
  person + day, `pending` → `approved`); `chore_completions` rebuilt with UNIQUE(chore, day, **person**)
  (rows copied). `runMigrations(sqlite, upTo)` lets tests upgrade a v1 database.
  - 'each' chore: every assignee ticks it separately (own stars); `DayChoreDto.assignees/doneBy`. Chores tab
    shows a name pill per person (tap = toggle that person); elsewhere the "Who did it?" popup lists only the
    assignees with ticks and toggles.
  - Checklist (Settings → Chores → Checklists, PIN-gated like chores): items are chores with `checklist_id`,
    0 stars, schedule/assignees from the checklist. A person ticking every item that day → unlock `pending`
    (toast "ask a parent to sign off"); a parent approves under Settings → Chores → Waiting for approval →
    "Unlocked!". Un-ticking an item removes that person's unlock (even approved). Resets daily (unlocks are
    per day). Shown as a card at the top of the Chores tab, a section of the home tile, and the companion.
  - Channels (all `chores:`): checklists, checklistCreate/Update/Delete, checklistsDay, pendingUnlocks,
    approveUnlock; `uncomplete` takes optional `personId` (required for 'each').
- v0.8.38: home "Chores today" tile — a claimed chore's filled circle shows the claimer's initial (in their
  colour) instead of a tick; the separate initial on the right is gone. "Everyone" chores keep the green tick
  when all are done, with the doers' mini initials on the right.
- v0.8.39: home chores tile — an "Everyone" chore shows **one circle per person** (filled with their initial
  once done, an outline with a faint initial until then; replaces the right-hand mini initials). Plain chores
  are sorted multi-person first, then A–Z within each kind (checklist items keep their checklist order). The
  circle column is as wide as the most circles any row has, so every title starts at the same x.
- v0.8.40: **changing events needs the parent PIN** (when one is set). `events:create/update/delete` are in
  `PARENT_GATED`. The editor (`EventEditor.tsx`) uses the new `useParentGate()` (`components/ParentGate.tsx`:
  reads `auth:getStatus` fresh, prompts with `PinDialog` only when locked, runs the action after a valid PIN):
  a new event asks before the editor opens (cancel = no editor); an existing event still opens for anyone to
  read, and Save / Delete ask first. Closing the editor re-locks if the gate unlocked it.
- v0.8.41: **all-day events can't spill onto the next day.** They're stored as midnights in the zone they were
  synced/saved in (`events.tz`); if the device zone differs later (e.g. a Surface first set to Pacific), a
  Nov 5 event showed on Thu 5 *and* Fri 6. `getOccurrences` now re-anchors every all-day occurrence to
  midnights of its date in the device zone (`allDayInZone` in `eventService.ts`), so every view is safe. Boot
  re-downloads all calendars in full when the device zone differs from the one stored under the settings key
  `sync.deviceTz` (once on upgrade, then on any zone change), and Google sync now rewrites an all-day event
  whose stored `tz` differs even when its etag is unchanged. Home "Chores today" tile is now titled "Chores".
- v0.8.42: home chores tile titled "Today's chores".
- v0.8.43: header menu is Home · Week · Month · Lists — no Chores button. The Chores view stays (tap the
  "Today's chores" home tile to open it; it keeps its own text size in Settings).
- v0.8.44: tapping the "Today's chores" tile no longer opens the Chores view (no `navTarget`); tapping a chore
  still claims it. The Chores view is now reached only from the Star balances tile.
- v0.8.45: header shows each **child's star balance** as a circle in their colour (number inside, `useBalances`),
  centred between the weather and the family filter (`flex-1` either side). Tapping one opens the Chores view
  (Rewards) — the way in now that the menu button and the chores tile's tap are gone.
- v0.8.46: the star circles are as tall as the date + clock block (60px; 48px below 1300px, 64px from 1500px)
  with a ★ above the number, and show **on Home only** — with the period nav, the worst case (Wednesday,
  12:59, "Dec 30 – Jan 5", −12° with high/low) ran the header ~70px past 1440 and pushed Lists off-screen.
- v0.8.47: header's person-filter circles hidden (`SHOW_PERSON_FILTER = false` in `Header.tsx`) — events aren't
  assigned to people here. `hiddenPeople` isn't persisted, so nothing can stay filtered out.
- v0.8.48: phone companion tabs are Chores · Lists · Meals · Agenda, and it opens on Chores.
- v0.8.49: companion's Today chores use the home tile's order — `sortDayChores` (`src/shared/choreOrder.ts`,
  Everyone chores first, then A–Z), shared by both so they can't drift.
- v0.8.51: companion Chores opens with a **Stars** card (each child, ★ balance; everyone if no children). Tap a
  child → bottom sheet: − / + or type the new total, Save. New channel `stars:adjust` {personId, delta} →
  `rewards.adjust` writes one `manual_adjust` ledger row, refuses unknown people. It's in
  `COMPANION_CHANNELS` (phones aren't PIN-gated, like chores:create there) and `PARENT_GATED` on the kiosk;
  mutation domain `chores` so the kiosk's balances refresh.
- v0.8.52: companion — tapping an "anyone" chore (its circle or its title) opens a "Who did it?" bottom sheet
  (`ClaimSheet`, one big button per person) instead of expanding a picker inside the list. Both sheets share
  a local `Sheet` frame in `ChoresPage.tsx`. Tapping a done one still un-ticks it.
- v0.8.53: companion Chores' per-person summary card ("N today · ★ N") hidden (`SHOW_FAMILY_SUMMARY = false`).
- v0.8.54: companion tabs are Chores · Lists · Meals — no Agenda (`AgendaPage.tsx` kept, unused).
- v0.8.55: "Add a tile" no longer offers Clock, Camera or Birds (`pickable: false` in `tileRegistry.tsx`); one
  already on the home screen keeps working and can still be removed.
- v0.8.56: companion Stars card rows are name · − · ★ N · + (each tap `stars:adjust` ±1);
  tapping the name still opens the type-a-total sheet.
- v0.8.57: **balances may go negative** — `rewards.adjust` no longer refuses below 0, the − button is never
  disabled, and the sheet accepts a negative total. Redeeming a reward still needs enough stars.
- v0.8.58: **3-day chore history.** Tapping the home tile's title ("Today's chores ›", a `role="button"` div)
  opens `ChoreHistoryDialog` (`features/chores/ChoreHistory.tsx`): today, yesterday, the day before — each
  person with the chores they ticked (from `chores:getDay` + `checklistsDay` per date). Window is
  `CHORE_HISTORY_DAYS` in `src/shared/choreHistory.ts`. Main purges `chore_completions` due before the oldest
  day shown at boot and hourly (`chores.purgeCompletionsBefore`); `star_ledger` is never touched, so balances
  and their log are unchanged (test covers it). Older days can no longer be un-ticked — they aren't shown.
- v0.8.59: **chores roll over at midnight.** The home chores and meals tiles read `today()` only when they
  happened to re-render, so a kiosk left on Home showed yesterday's ticks after midnight. They now use
  `useTodayKey()` (re-checked every minute, like This week). The companion got the same: `useToday()` in
  `companion/src/api/hooks.ts`, used by ChoresPage, MealsPage and the header date.
- v0.8.60: header star circles are display-only (`div`s, no tap action). The Chores view is now reached only from
  the Star balances tile.
- v0.8.61: weather tile is today (labelled "Today") + the next 4 days — `daily.slice(0, 5)`, was tomorrow on.
- v0.8.62: the companion edits chores fully — `ChoreSheet` (name, Whoever/Everyone + people, stars, time of day,
  repeats with weekdays, Pause/Resume, two-tap Delete) from + New chore or Manage; `ChecklistSheet` + a "Waiting for
  you" Approve card. `COMPANION_CHANNELS` gained chores:delete + the checklist/unlock channels (a paired phone is
  trusted: pairing needs the kiosk PIN). Schedule helpers moved to `src/shared/choreSchedule.ts`; `anchorOnSave`
  re-anchors a repeating chore switched to One time to today (kiosk too — it used to never show again).
- v0.8.63: `--tablet` launch flag previews the Surface on a dev PC — fixed 1440×960 content window +
  `force-device-scale-factor=1.5` (index.ts, before ready) = 2160×1440 px. Desktop shortcut "OpenSkyLight (tablet
  preview)" runs `dist\win-unpacked\OpenSkyLight.exe --tablet`, so it always opens the latest `npm run dist`.
- v0.8.64: This week tile labels its first day (tomorrow) "Tmrw" instead of "ccc d".
- v0.8.66: This week tile day labels are weekday only ("Fri") — `ccc`, was "ccc d"; tomorrow stays "Tmrw".
- v0.8.67: photos change every 10 s on the screensaver (`SLIDE_MS`, was 12 s) and the home photo tile
  (`PHOTO_TILE_MS`, was 30 s).
- v0.8.68: Today's chores tile has no progress bar (or its done/total count) — straight to checklists and chores.
- v0.8.69: Today tile's meal strip 1.5× bigger (`MealStrip large`: text-lg, 28px slot circles); Week view unchanged.
- v0.8.70: user meant 2.5×, not 1.5× — Today tile meal strip now text-3xl (30px), 44px slot circles.
- v0.8.71: Today tile meal strip back to 75% of that — 22.5px text, 33px slot circles.
- v0.8.72: Alberta Time — Alberta stayed on UTC−6 from 2026-11-01 (Official Time Act), but Electron 34's ICU tz is
  2024b and still falls back. `src/shared/zones.ts` `zoneFor(tz)` swaps America/Edmonton (+ Yellowknife, Canada/Mountain)
  for a Luxon zone that is −6 after the cutover; used in recurrence expansion, Google EXDATE/RDATE/date parsing and
  all-day anchoring. Fixed repeating Edmonton series 1h late after Nov 1 and Google's moved instances showing twice
  ("Jarred at Terwilliger"). Drop it once the bundled tz data knows. Display uses the PC zone (this PC: Saskatchewan).
- v0.8.73: every ★ is now a game controller — `GameIcon` (solid, 1.2em, currentColor) in renderer `components/icons.tsx`
  and companion `components/ui.tsx`; the stars toast says 🎮. Words ("stars", Rewards) unchanged.
- v0.8.74: header kids' star badges twice as far apart (gap-1.5 → gap-3).
- v0.8.75: header star badges 18px apart (gap-4.5).
- v0.8.76: Environment Canada weather alerts — `src/shared/weatherAlerts.ts` (GeoMet `weather-alerts`, tiny bbox around
  the weather location; drops ended/cancelled/expired, one per alert code, warning>watch>advisory>statement), fetched
  with the forecast (`WeatherDto.alerts`, failures keep the last alerts). Weather tile: risk-coloured strip on top;
  header weather button: coloured ⚠ badge, forecast dialog lists alerts in full (`features/weather/WeatherAlerts.tsx`).
- v0.8.77: screensaver "Next up" card top-left (`ScreensaverGlance` in KioskOverlays): next two timed events today,
  "Now" while one is on; hidden once the day is done. Chores were tried there and removed at the user's request.
- v0.8.78: Next up card text smaller to fit more of the titles (24px / 18px, card up to 40rem wide).
- v0.8.79: Next up card 50% wider (max 60rem).
- v0.8.80: Next up card runs into tomorrow ("Tmrw" before the time) once today's timed events are done/too few;
  an overnight event stays under today.
- v0.8.81: Next up card swaps left/right (text aligned to that edge, fade-in) every time the screensaver photo changes.
- v0.8.82: user preferred the swap on a timer: Next up card changes sides once a minute (`GLANCE_SWAP_MS`), not per photo.
- v0.8.83: Next up card lists three events (third styled like the second).
- v0.8.84: backups — `src/main/backup/` (backupFiles.ts pure + tested; backupService.ts). SQLite online backup
  (`sqlite.backup`, integrity-checked) to userData/backups/openskylight-YYYY-MM-DD.db nightly (inside the sleep window,
  or 3 am with sleep off; also ~1 min after start if >24h old; Settings → General → Backups "Back up now"); optional
  extra folder (USB/network — the Surface has no OneDrive) gets a copy. Keeps 14 days + newest per month for 12 months.
  Restore (PIN-gated, two taps) copies the backup to `openskylight.db.restore` and relaunches (portable: relaunches
  PORTABLE_EXECUTABLE_FILE); boot swaps it in via `applyPendingRestore` after saving `before-restore-<stamp>.db`.
  State in settings raw keys `backup.*`; gear shows an ember dot when backups fail or are >3 days old. Preload has its
  own channel allowlist (`src/preload/index.ts`) — new IPC prefixes must be added there too.
- v0.8.85: Week view columns sit closer — grid `gap-1` (4px), was `gap-3`.
- v0.8.86: Week view side margins halved — `px-3` (12px), was `px-6`.
- v0.8.89: Week view columns nearly touch — grid `gap-0.5` (2px), was `gap-1`.
- v0.8.103: Week view column gap halved again — `gap-px` (1px), was `gap-0.5`.
- v0.8.104: game time log. DB migration v6 `star_ledger.note`; every write now says what it was for (chore title, "Reward:
  …", "🎮 Video Games set — approved", "Changed by a parent", "Used game time"). Un-ticks and withdrawn Video Games sets
  no longer DELETE ledger rows: `reverse()` adds a minus line ("Un-ticked: …"), so balances are identical but the log
  keeps both. `stars:log` {personId|null, limit} → newest first with per-kid running `balanceAfter`; old note-less rows
  get a best-guess description. Settings → Chores, top: `features/chores/GameTimeLog.tsx` (kid filter, Show more).
- v0.8.105: Video Games approvals can't be missed. `pendingUnlocks(date)` now returns Video Games rounds from any
  day up to `date` (they used to vanish at midnight, unpaid), oldest day first; lists show "· yesterday" / "· Mon Nov 3"
  (`src/shared/dayLabel.ts`). Kiosk pop-up `features/chores/ApprovalOverlay.tsx` (z-[84]: over screens + screensaver,
  under notes and sleep): "Emma finished 🎮 Video Games! Approve 🎮 60?" — Approve (PinDialog when a PIN is set, then
  re-locks) / Not now (snoozes that request 30 min).
- v0.8.106: the game time log on the phone — Chores → Game time card → History (`GameTimeLogSheet` in companion
  ChoresPage: kid filter, Show more). `stars:log` added to `COMPANION_CHANNELS` (read-only).
- v0.8.107: game time countdown. "Use your time" now converts controllers at a fixed 1 point = 1 minute plus
  `SETUP_MINUTES` = 3 (`src/shared/gameTime.ts`; user asked for both hard-coded) and starts a timer kept main-side in
  settings key `gameTime.timers` (survives restarts; using time again while playing extends the running timer).
  `stars:timers` / `stars:stopTimer`; `stars:useTime` returns {used, minutes, timer}; log note "Used game time (1 h 03 min)".
  `features/chores/GameTimers.tsx` (z-[83]): a countdown pill per kid bottom-centre (every screen + screensaver,
  two-tap Stop), and when one runs out a "<name>'s game time is up!" card + the timer chime until OK (quiet in sleep).
  Toasts move up (bottom-28, z-[84]) while any game timer shows so they don't hide behind the pills.
- v0.8.108: a "Not now"-ed Video Games request can be brought back by the kid: snoozes live in
  `stores/approvalStore.ts` (`reopen(personId?)`, `focus` puts that kid's request first). Tapping a kid's header badge
  while they have a set waiting reopens the approval pop-up instead of "use your time?" (`UseTimeDialog` hands off and
  closes — Header.tsx untouched); the tile's "🎮 VIDEO GAMES" line is a button that reopens it too (stops the tile tap).
  Stopping a game timer early refunds the time left, rounded up to a whole minute, capped at the controllers spent on it
  (`refundPoints`; timers now carry `points`, summed when extended; setup minutes never refunded). Ledger +N "Game time
  stopped early (N min back)"; toast "🎮 N back to …". `stars:stopTimer` returns {refunded}; OK on a finished one = 0.
- v0.8.109: phone Game time card has an "All" row (2+ kids) — − / + call `stars:adjust` once per kid, ±1 each.
- v0.8.110: header top-left — the big clock now comes first, then the divider, then weekday + date (were swapped).
- v0.8.111: family-note chime rings longer — `chimeLoop(NOTE_CHIME_MS, 1.2)` (1.2s fade per note, was 0.5s); the timer alarm keeps 0.5s.
- v0.8.112: countdowns. DB migration v7 `countdowns` (title, emoji, ISO date, soft delete); `countdownsService` lists
  today+future soonest first, refuses blank names and past days. IPC `countdowns:*` (phone allowlist; create/update/delete
  PIN-gated on the kiosk; push domain 'countdowns'). Wording `src/shared/countdown.ts`: "Today!" / "Tomorrow" / "N days"
  (user chose days, not sleeps). Home tile type 'countdowns' (`features/countdowns/CountdownsTile.tsx`, registry +
  TILE_SPECS + the settings zod enum — a test now checks the enum covers every TILE_SPECS type); Settings → General
  `CountdownsSection` (OSK name, emoji row, DateField); screensaver card adds the nearest ("🎄 51 days until …");
  phone Notes tab `CountdownsCard` (native date input). Not on the default layout: add the tile with ✏️.
- v0.8.113: screensaver layout — Next up card fixed top-left (no more side swap), a twin Countdowns card top-right
  (next 3, `countdownLabel`; replaces the countdown line in Next up), weather beside the clock/date bottom-left.
- v0.8.114: screensaver Next up card moved to the bottom-right (user asked, superseding v0.8.113's top-left);
  `GLANCE_CARD` no longer carries a position — Countdowns adds `top-10 right-12`, Next up `right-12 bottom-10`, or
  `bottom-28` while a game timer pill (bottom-centre) is showing, so they never overlap.
- v0.8.115: screensaver bottom-left: the weather is small (temp text-4xl 36px, icon h-11, high/low text-lg; was
  72px) and sits just right of the time on the clock's row, with the date underneath both.
- v0.8.116: meals editor always opens on what's saved for the day tapped (blank if nothing is set). It kept
  its typed text forever, so Week view showed the last day's typing on another day — and Save could write it there
  — and cancelled text or stale text after a phone edit came back. `MealsDialog` now mounts a fresh `MealsEditor`
  (keyed by date) on every open.
- v0.8.117: screensaver bottom-left 1.5× v0.8.115 — time text-[108px], date text-4xl (36px), weather icon 66px,
  temperature 54px, high/low 27px. Next up shows four events, every line text-2xl and full white (was a big first
  line and smaller dimmed ones; `data-next-up-line`). With a game timer the pill only shares a row with the date.
- v0.8.118: screensaver Next up shows five events (Linear OPE-15). Card is ~248px tall at the bottom-right; with a
  game timer it lifts to bottom-28 and still clears the pill and the Countdowns card.
- v0.8.119: screensaver Next up + Countdowns cards 25% less opaque — `bg-black/34`, was `/45`.
- v0.8.120: screensaver items hug the edges — Countdowns `top-5` (20px, was 40), clock/date/weather and Next up
  `bottom-5` (was `bottom-10`). Next up still lifts to `bottom-28` while a game timer pill shows.
- v0.8.121: and the sides — clock block `left-6`, Next up and Countdowns `right-6` (24px, was 48).
- v0.8.122: screensaver top/bottom gaps halved again — Countdowns `top-2.5`, clock block and Next up `bottom-2.5`
  (10px). Sides stay 24px; Next up still lifts to `bottom-28` over a game timer pill.
- v0.8.123: two-way Notes — DB migration v8 `note_replies` (note_id, text, author_id, from_kiosk). Tablet replies go
  through kiosk-only `notes:kioskReply` (not in COMPANION_CHANNELS, so a phone can't post as the tablet); phones use
  `notes:reply` and `notes:recent` (open notes + last 2 days by latest message, newest first). A phone reply to a done/
  expired note reopens it (an "until tonight" one gets the rest of today). NoteOverlay: thread + quick replies + "Write…";
  chimes only while the phone has the last word. Phone has no push — it sees replies on its 20s poll while open.
- v0.8.124: parent PIN — `PinDialog autoAccept` (the four "check the PIN" dialogs: ParentGate, Settings, Home edit,
  approvals) quietly calls `auth:verifyPin` after each digit from the 4th and submits as soon as the digits are the
  PIN; a wrong PIN still waits for OK, which shows the error. Off for choosing a new PIN. Events: tapping an existing
  event now asks for the PIN before the editor opens (was only on Save/Delete); `allowedKey` resets on close, so
  reopening the same event asks again.
- v0.8.125 (OPE-16): after swiping the Week view, Chromium sometimes drops the *click* of the next touch tap
  (pointerdown/up reach the button, no click; ~40% of runs, gone after ~1 s; Month unaffected; animation/overflow CSS
  didn't help). `src/shared/tapFallback.ts`, installed in renderer main.tsx for `<button>`s: a still touch tap (≤10px,
  ≤700ms, lifted on the same button) with no click within 120ms gets `button.click()`; a late real click within
  600ms is swallowed. Repro: CDP touch — Home → Week → 2 swipes → tap header date; was 5–7/16 lost, now 0/16.
- v0.8.126: pairing QR dialog — "Wrong network?" is now a button per other address ("Use Tailscale" / "Use home
  Wi-Fi", IP beside it) that redraws the QR for that host with the same token; a line says which network the code
  uses (`networkLabel`: 100.64/10 = Tailscale, RFC1918 = home Wi-Fi). Pair phones on the Tailscale address to use
  the companion away from home (the phone's Tailscale app must be on).
- v0.8.127: phones update live. Companion `GET /api/events` (Bearer auth) streams `data: {"domain"}` for every
  `push:dataChanged` (router `onBroadcast` → `companion.push`), with a `: ping` every 25s. The phone
  (`companion/src/api/live.ts`, fetch + header, not EventSource, so the token stays out of URLs) invalidates all
  queries on each event, reconnects after 3s or at once when the phone wakes, and refetches on reconnect. The 20s poll
  stays as the fallback. Measured: kiosk note → phone ≈ 50 ms (was up to 20 s).
  Note pop-up quick replies are now 👍, 👎, Not Yet, On my way, Thanks! (`QUICK_REPLIES` in NoteOverlay.tsx).
- v0.8.90: header — kids' controller badges moved left (after the weather); the free space to their right is an
  issue line (`features/shell/IssueLine.tsx`, rules in `src/shared/kioskIssues.ts`): Google sign-in expired → calendar
  sync errors → calendars not updated for 30 min (Wi-Fi?) → backup failed/folder/no backup; first issue + "+N more",
  tap opens Settings on the right tab (`setSettingsOpen(true, tab)`). Replaces the gear's backup dot. Sign-in warning
  now set on 401 or `invalid_grant` (`isSignInRefused`) and cleared whenever that account's calendar pulls OK.
- v0.8.91: kids' controller badges back on the right — directly before the screen selector (after the Week/Month
  date controls) and now on every screen; gap-3 between them on Week/Month. The issue line is a container: under
  11rem (Week/Month with 3 kids) it shrinks to a ⚠ button (+count), still tappable. Measured at 1440px: header never overflows.
- v0.8.92: "Tmrw" shown as written (not TMRW) on the This week tile and the screensaver Next up card; other weekdays stay in capitals.
- v0.8.93: family notes. DB migration v4 `notes` (author_id plain id, expires_at for "until tonight" = end of the
  posting day in the device zone, done_at). `notesService` list/add/done; IPC `notes:*` (in the phone allowlist, not
  PIN-gated; push domain 'notes'). Kiosk: `features/notes/NotesStrip.tsx` sticky cards above the home tiles (two-tap
  Done; theme colours so dark mode reads), screensaver card lists up to 2 under Next up. Phone: Notes tab (text ≤280,
  From chips remembered in localStorage, Until tonight). The v2→v3 migration test is pinned with runMigrations(sqlite, 3).
- v0.8.94: notes are a centred pop-up instead (`features/notes/NoteOverlay.tsx`, z-[85]: over every screen and the
  screensaver, under the sleep screen; stops pointer events reaching the screensaver). Oldest first (also the phone
  list — `notesService.list` sorts ascending), "1 of N", two-tap Done moves to the next. The home strip and the screensaver card's note list were removed.
- v0.8.87: phone → slideshow photos. Companion "Photos" tab (`src/companion/src/pages/PhotosPage.tsx`, `api/photos.ts`):
- v0.8.95: a waiting note dings every 10 s (`lib/alarm.ts` now has per-purpose chime loops: timers 1.5 s, notes
  `NOTE_CHIME_MS`), silent while the sleep screen is up (`kioskStore.sleeping`, set by KioskOverlays). The window has
  `autoplayPolicy: 'no-user-gesture-required'` so it sounds with no tap since start.
- v0.8.96: **Video Games chores** — chore mode 'videogames' (like 'each': every picked kid does each task; tasks
  forced to 0 stars and left out of `getDay`). The day's Video Games tasks form a set per kid; rounds = the fewest
  times any of their tasks was done (repeatable via "Times that day"). DB migration v5 `video_game_rounds` (one row
  per kid/day/round, pending → approved). `syncRounds` runs on every complete/uncomplete: adds pending rounds, removes
  ones that no longer hold (taking back paid controllers). Approval (`chores:approveUnlock` with checklistId =
  `VIDEO_GAMES_SET_ID` + round) pays the reward, stored as settings key `chores.videoGamesStars` (default 60;
  `chores:videoGamesStars` / `setVideoGamesStars`, Settings → Chores "🎮 Video Games reward"). The set appears in
  `checklistsDay` as kind 'videogames' (ticks = done this round), status text via `src/shared/setProgress.ts`.
  Phone: editor option "🎮 Games", and the "Waiting for you" approvals card shows at the top of every tab.
  UI branches on `mode !== 'anyone'` (not `=== 'each'`) for per-kid behaviour.
- v0.8.97: Video Games set reward defaults to 60 (was 5).
- v0.8.98: "Everyone" is no longer offered in either chore editor (Whoever / 🎮 Video Games); an existing 'each'
  chore still shows it when edited so it isn't converted by accident. 'each' itself is unchanged (checklist items use it).
- v0.8.99: the kiosk "Who did it?" popup now finds a Video Games task / checklist item in `checklistsDay` (it only
  looked in `getDay`, which leaves them out), so its count updates live; same lookup on the phone. Home tile: Video
  Games shows only this set's x/y per kid, never "+N" (Chores tab and phone still show controllers earned).
- v0.8.100: home tile, Video Games task circles: part-way (1/2) = outline + initial in the kid's colour; complete
  (count ≥ times, e.g. 2/2) = filled in their colour with a white initial (`circle(..., white)`). Everyone chores unchanged.
- v0.8.101: header kid badges are buttons → `features/shell/UseTimeDialog.tsx` "Do you want to use your time?" Yes/No;
  Yes = `stars:useTime` (rewardsService.useTime: ledger entry −balance, reason 'redemption'; NOT PIN-gated since it only
  lowers a balance; no-op at 0). Toast "Enjoy your time, …". With 0 saved it just says so.
- v0.8.102: on-screen "Stars" → "Game time" (home tile + tile picker, Settings chore/reward/Video Games fields and help,
  backup text, phone card/editor, aria labels). Code identifiers (starsValue, stars:*, star_ledger) unchanged.
  the phone redraws each photo to ≤2560px JPEG on a canvas (drops EXIF/GPS, turns HEIC into JPEG) and POSTs raw bytes to
  `/api/photos` (bearer token; not the 64 KB JSON rpc). Server routes in companionServer.ts (`authorize()` shared with rpc):
  GET/POST /api/photos, GET /api/photos/:name/thumb (nativeImage thumbnail; phone shows it via blob: URL — CSP img-src
  allows blob:), DELETE /api/photos/:name. Store `src/main/companion/phonePhotos.ts` saves `phone-YYYYMMDD-HHmmss-xxxxxx.jpg`
  into "From phones" inside the screensaver folder (creates Pictures\OpenSkyLight as the folder if none); only those names
  can be fetched/deleted (`photoUpload.ts`: byte sniffing, 10 MB cap). Kiosk listPhotos includes the subfolder; ShuffleDeck
  puts photos new since the last list at the front of the next pass. `npm run build` also builds the companion
  (`build:companion`) — a bare `electron-vite build` leaves the phone app stale.
- v0.8.88: phone Photos tab deletes several at once — Select (or tap any photo) → tick → Select all/Cancel → bottom bar
  "Delete N photos" → "Tap again to delete N"; deletes one by one with progress.
- v0.8.65: chores done more than once a day — `chores.times` (DB migration v3: 0 = no limit; completions lose
  UNIQUE(chore,date,person)). Only Weekly/One time chores get "Times that day" (1–10 or No limit; Every day saves 1);
  it resets on each due day. `DayChoreDto.times` + `claims` (every tick, oldest first); done = reached times (≥1
  for no limit); `uncomplete` takes back the newest tick. Counted chores always open "Who did it?", which stays
  open (count, Undo last / per-person −, Done). Tile: one circle per time up to 5, else latest + open; `2/3`/`×6`.
  Shared helpers `src/shared/choreCount.ts`.
- v0.8.50: sleep (dark) screen clock + weather 1.5× bigger — 90px text, 108px icon, 50px high/low.

## Wishlist (not started)

Empty (the 2026-11-05 items are done or dropped).

## Release checklist

1. On the feature branch, bump the version first (`npm version X.Y.Z --no-git-tag-version`,
   above upstream's latest and our last release) so the tested exe reports it.
2. Green: `npm test`, `npm run typecheck`.
3. `npm run dist` → hand me `dist\OpenSkyLight 0.8.0.exe` to test on the Surface.
   **Wait for my approval.**
4. Merge to `main`, tag `vX.Y.Z`, push `main` and **only that tag**
   (`git push origin main vX.Y.Z` — never `--tags`, which would push upstream's tags).
5. Watch the Release workflow on the fork; confirm the release has both exes and `latest.yml`.
