import { isNewer } from '@shared/appVersion'

/**
 * Deploying a new kiosk exe over the network (v0.8.183). `npm run deploy` on the dev PC copies the
 * new portable exe into the folder the kiosk's exe runs from (shared on the home network) and
 * writes `next.json` last. The kiosk sees it, checks it, and swaps itself: a small PowerShell
 * script waits for the app to quit, keeps the old exe as `…prev.exe`, moves the new one into place
 * under the same name (the autorun points at it), starts it, and puts the old one back if the new
 * one doesn't report in. Trust = write access to that Windows share; nothing listens on the network.
 * Pure helpers here (tested); the watcher is deployWatcher.ts.
 */
export const DEPLOY_MANIFEST = 'next.json'
/** What the new version writes into userData once it has started. */
export const DEPLOY_OK_FILE = 'deploy-ok.json'
/** How long the swap script waits for the new version to report in before rolling back. */
export const DEPLOY_OK_WAIT_S = 120

export interface DeployManifest {
  version: string
  /** the new exe's file name, in the same folder as next.json */
  file: string
  /** lowercase hex SHA-256 of that file */
  sha256: string
  /** install even if not newer (a deliberate rollback / re-deploy) */
  force?: boolean
}

/** A next.json that's safe to act on, or null. The file must be a bare .exe name in the same folder. */
export function parseManifest(text: string): DeployManifest | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version)) return null
  if (typeof m.file !== 'string' || !/^[A-Za-z0-9][\w .-]*\.exe$/i.test(m.file) || m.file.includes('..')) return null
  if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(m.sha256)) return null
  return { version: m.version, file: m.file, sha256: m.sha256.toLowerCase(), force: m.force === true }
}

/** Install it? Only a newer version, unless the deploy was forced (then anything but a no-op). */
export function shouldApply(current: string, m: DeployManifest): boolean {
  return m.force ? true : isNewer(m.version, current)
}

/** `OpenSkyLight 0.8.0.exe` → `OpenSkyLight 0.8.0.prev.exe` (the copy kept for rollback). */
export function prevPath(exe: string): string {
  return exe.replace(/\.exe$/i, '') + '.prev.exe'
}

/** A PowerShell single-quoted literal. */
export function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

export interface SwapPaths {
  /** the running portable exe (the autorun's target) */
  exe: string
  /** the new exe, next to it */
  next: string
  manifest: string
  /** userData/deploy-ok.json */
  okFile: string
  log: string
  version: string
}

/**
 * The swap, run detached after the app quits. Waits (up to 60 s) until the old exe is no longer
 * in use, moves old → .prev.exe and new → exe, starts it, then waits for the new version to write
 * its deploy-ok marker; if it doesn't within DEPLOY_OK_WAIT_S, stops it and restores the old exe.
 */
export function swapScript(p: SwapPaths): string {
  const prev = prevPath(p.exe)
  return `$ErrorActionPreference = 'Continue'
# once loaded, this script file isn't needed: don't leave one in %TEMP% per deploy
Remove-Item -LiteralPath $PSCommandPath -ErrorAction SilentlyContinue
$exe = ${psQuote(p.exe)}
$next = ${psQuote(p.next)}
$prev = ${psQuote(prev)}
$manifest = ${psQuote(p.manifest)}
$ok = ${psQuote(p.okFile)}
$log = ${psQuote(p.log)}
$version = ${psQuote(p.version)}
function Say($m) { Add-Content -LiteralPath $log -Value ("{0:s} {1}" -f (Get-Date), $m) }
function Wait-Unlocked($path) {
  for ($i = 0; $i -lt 120; $i++) {
    try { $f = [IO.File]::Open($path, 'Open', 'ReadWrite', 'None'); $f.Close(); return $true } catch { Start-Sleep -Milliseconds 500 }
  }
  return $false
}
function Stop-Kiosk { Get-Process | Where-Object { $_.Name -like 'OpenSkyLight*' } | Stop-Process -Force -ErrorAction SilentlyContinue }
Say "deploy $($version): waiting for the running kiosk to close"
if (-not (Wait-Unlocked $exe)) { Say 'old exe still in use after 60 s; stopping it'; Stop-Kiosk; Start-Sleep 2 }
Remove-Item -LiteralPath $manifest -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $ok -ErrorAction SilentlyContinue
try {
  if (Test-Path -LiteralPath $prev) { Remove-Item -LiteralPath $prev -Force }
  Move-Item -LiteralPath $exe -Destination $prev -Force
  Move-Item -LiteralPath $next -Destination $exe -Force
} catch {
  Say "swap failed: $_"
  if (-not (Test-Path -LiteralPath $exe) -and (Test-Path -LiteralPath $prev)) { Move-Item -LiteralPath $prev -Destination $exe -Force }
  Start-Process -FilePath $exe -WorkingDirectory (Split-Path -LiteralPath $exe)
  exit 1
}
Say "swapped; starting $version"
Start-Process -FilePath $exe -WorkingDirectory (Split-Path -LiteralPath $exe)
for ($i = 0; $i -lt ${DEPLOY_OK_WAIT_S}; $i++) {
  Start-Sleep 1
  if (Test-Path -LiteralPath $ok) {
    try { if ((Get-Content -LiteralPath $ok -Raw | ConvertFrom-Json).version -eq $version) { Say "$version started OK"; exit 0 } } catch {}
  }
}
Say "$version did not report in within ${DEPLOY_OK_WAIT_S} s; rolling back"
Stop-Kiosk
Start-Sleep 2
Wait-Unlocked $exe | Out-Null
$failed = $exe -replace '\\.exe$', '.failed.exe'
Remove-Item -LiteralPath $failed -ErrorAction SilentlyContinue
Move-Item -LiteralPath $exe -Destination $failed -Force
Move-Item -LiteralPath $prev -Destination $exe -Force
Start-Process -FilePath $exe -WorkingDirectory (Split-Path -LiteralPath $exe)
Say 'rolled back to the previous exe'
exit 2
`
}
