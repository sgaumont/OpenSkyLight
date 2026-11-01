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
  as the longest time shown and every name lines up (all-day rows leave it blank).

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
