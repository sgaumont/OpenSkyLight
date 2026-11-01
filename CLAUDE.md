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
- Currently runs the **portable exe** of upstream's build (v0.8.0 or earlier).
  Only the NSIS (Setup) install auto-updates; the portable exe never does.
  Both share `%APPDATA%\OpenSkyLight`, so switching install type keeps all data.
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

## Wishlist (not started)

- Text sizes. Plan: a global "Text size" setting first (scale the root `rem`;
  nearly all Tailwind sizing is rem-based), then the two overrides below.
  - Per-tab font sizes (calendar, chores, lists, meals, etc.).
  - Per-tile font sizes on the home screen.
- Scrollable tiles on the Home tab (tiles currently clip overflow).
- Screensaver: shuffle photos, showing every photo once per pass, then start
  a new random order (no repeats until all have been shown).
- Home photo tile: tap to advance to the next picture.

## Release checklist

1. Feature branch green: `npm test`, `npm run typecheck`.
2. `npm run dist` → test the portable exe from `dist\` on the Surface.
3. Merge to `main`, bump `package.json` version above upstream's latest, tag `vX.Y.Z`,
   `git push origin main --tags`.
4. Watch the Release workflow on the fork; confirm the GitHub Release has the
   installer, `latest.yml`, and blockmap.
