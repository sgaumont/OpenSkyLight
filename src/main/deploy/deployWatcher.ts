import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEPLOY_MANIFEST, DEPLOY_OK_FILE, parseManifest, psQuote, shouldApply, swapScript } from './deployFiles'

/** How often the kiosk looks for a deployed exe. */
const CHECK_MS = 15_000

export interface DeployWatcherDeps {
  version: string
  userData: string
  /** the running portable exe (PORTABLE_EXECUTABLE_FILE); null = not a portable build: no deploys */
  exePath: string | null
  /** quit the app so the swap can happen */
  quit: () => void
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

/** Starts `command` through WMI (Win32_Process.Create), so it isn't this app's child. True if it started. */
function startOutsideApp(command: string): Promise<boolean> {
  const ps = `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(command)} }; exit [int]$r.ReturnValue`
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('exit', (code) => resolve(code === 0))
  })
}

/**
 * Watches the kiosk exe's own folder for `next.json` (written last by `npm run deploy`) and
 * installs a newer, checksum-matching exe right away (the user chose "immediately"): writes the
 * swap script, starts it detached, and quits. See deployFiles.ts for the whole flow.
 */
export function createDeployWatcher(deps: DeployWatcherDeps) {
  const log = join(deps.userData, 'deploy.log')
  const say = (m: string): void => {
    try {
      writeFileSync(log, `${new Date().toISOString()} ${m}\n`, { flag: 'a' })
    } catch {
      // logging is best effort
    }
  }
  let timer: ReturnType<typeof setInterval> | null = null
  let busy = false

  /** Set aside a next.json we won't act on, so it isn't read every 15 s. */
  function setAside(manifestPath: string, why: string): void {
    say(`ignored next.json: ${why}`)
    try {
      renameSync(manifestPath, manifestPath.replace(/\.json$/, '.ignored.json'))
    } catch {
      rmSync(manifestPath, { force: true })
    }
  }

  async function check(): Promise<void> {
    if (busy || !deps.exePath) return
    const dir = dirname(deps.exePath)
    const manifestPath = join(dir, DEPLOY_MANIFEST)
    if (!existsSync(manifestPath)) return
    busy = true
    try {
      const m = parseManifest(readFileSync(manifestPath, 'utf8'))
      if (!m) return setAside(manifestPath, 'not a valid deploy manifest')
      const next = join(dir, m.file)
      if (next.toLowerCase() === deps.exePath.toLowerCase()) return setAside(manifestPath, 'names the running exe')
      if (!shouldApply(deps.version, m)) return setAside(manifestPath, `${m.version} is not newer than ${deps.version}`)
      if (!existsSync(next)) return setAside(manifestPath, `${m.file} is missing`)
      if ((await sha256(next)) !== m.sha256) return setAside(manifestPath, `${m.file} checksum doesn't match`)
      const script = join(tmpdir(), `openskylight-deploy-${Date.now()}.ps1`)
      writeFileSync(
        script,
        swapScript({ exe: deps.exePath, next, manifest: manifestPath, okFile: join(deps.userData, DEPLOY_OK_FILE), log, version: m.version }),
        'utf8'
      )
      say(`installing ${m.version} (was ${deps.version})`)
      // The swap must outlive this app. A plain (even detached) child is closed together with the
      // portable exe's process group, so Windows' process service (WMI) starts it instead: it then
      // belongs to nobody here.
      const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}"`
      const launched = await startOutsideApp(command)
      if (!launched) {
        say('could not start the swap script; staying on this version')
        return setAside(manifestPath, 'swap script did not start')
      }
      setTimeout(deps.quit, 500)
      // busy stays true: the app is going away
    } catch (e) {
      say(`deploy check failed: ${(e as Error).message}`)
      busy = false
    } finally {
      if (busy && !existsSync(manifestPath)) busy = false
    }
  }

  return {
    /** This version is up and running: the swap script waits for this before keeping it. */
    markStarted(): void {
      try {
        writeFileSync(join(deps.userData, DEPLOY_OK_FILE), JSON.stringify({ version: deps.version, at: new Date().toISOString() }))
      } catch (e) {
        say(`couldn't write ${DEPLOY_OK_FILE}: ${(e as Error).message}`)
      }
    },
    start(): void {
      if (!deps.exePath || timer) return
      timer = setInterval(() => void check(), CHECK_MS)
      setTimeout(() => void check(), 5_000)
    },
    stop(): void {
      if (timer) clearInterval(timer)
      timer = null
    },
    check
  }
}
