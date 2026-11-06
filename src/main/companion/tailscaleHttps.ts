import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * The kiosk's secure Tailscale address for the phone app: `https://<machine>.<tailnet>.ts.net/`,
 * which `tailscale serve` forwards to the companion port. Phones only allow notifications on an
 * https page, so this is the address that gets them.
 */
export interface TailscaleHttps {
  /** e.g. "surface.tail1234.ts.net"; null when Tailscale isn't installed, signed in or has no MagicDNS name */
  host: string | null
  /** the tailnet has HTTPS certificates turned on */
  certs: boolean
  /** `tailscale serve` forwards https to this port */
  serving: boolean
}

export const NO_TAILSCALE: TailscaleHttps = { host: null, certs: false, serving: false }

/** Reads `tailscale status --json` and `tailscale serve status --json` output (pure, for tests). */
export function parseTailscale(statusJson: string, serveJson: string, port: number): TailscaleHttps {
  let host: string | null = null
  let certs = false
  try {
    const status = JSON.parse(statusJson) as { BackendState?: string; Self?: { DNSName?: string }; CertDomains?: string[] | null }
    if (status.BackendState === 'Running') {
      host = (status.Self?.DNSName ?? '').replace(/\.$/, '') || null
      certs = Array.isArray(status.CertDomains) && host !== null && status.CertDomains.includes(host)
    }
  } catch {
    return NO_TAILSCALE
  }
  let serving = false
  try {
    const serve = JSON.parse(serveJson || '{}') as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> }
    for (const [hostPort, web] of Object.entries(serve.Web ?? {})) {
      if (!hostPort.endsWith(':443')) continue
      const root = web.Handlers?.['/']?.Proxy ?? ''
      if (new RegExp(`^(https?://)?(127\\.0\\.0\\.1|localhost):${port}/?$`).test(root) || root === String(port)) serving = true
    }
  } catch {
    // no serve config
  }
  return { host, certs, serving }
}

const CLI_PATHS = ['C:\\Program Files\\Tailscale\\tailscale.exe', 'tailscale']

function run(exe: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(exe, args, { timeout: 5_000, windowsHide: true }, (err, stdout) => resolve(err ? '' : stdout))
  })
}

/** Asks the Tailscale CLI (cached for a minute; never throws). */
export function createTailscaleHttps() {
  let cache: { at: number; port: number; value: TailscaleHttps } | null = null
  return async function lookup(port: number): Promise<TailscaleHttps> {
    if (cache && cache.port === port && Date.now() - cache.at < 60_000) return cache.value
    const exe = CLI_PATHS.find((p) => p === 'tailscale' || existsSync(p)) ?? 'tailscale'
    const [status, serve] = await Promise.all([run(exe, ['status', '--json']), run(exe, ['serve', 'status', '--json'])])
    const value = status ? parseTailscale(status, serve, port) : NO_TAILSCALE
    cache = { at: Date.now(), port, value }
    return value
  }
}
