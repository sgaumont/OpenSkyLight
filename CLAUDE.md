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

## Wishlist (not started)

- (empty)

## Release checklist

1. On the feature branch, bump the version first (`npm version X.Y.Z --no-git-tag-version`,
   above upstream's latest and our last release) so the tested exe reports it.
2. Green: `npm test`, `npm run typecheck`.
3. `npm run dist` → hand me `dist\OpenSkyLight 0.8.0.exe` to test on the Surface.
   **Wait for my approval.**
4. Merge to `main`, tag `vX.Y.Z`, push `main` and **only that tag**
   (`git push origin main vX.Y.Z` — never `--tags`, which would push upstream's tags).
5. Watch the Release workflow on the fork; confirm the release has both exes and `latest.yml`.
