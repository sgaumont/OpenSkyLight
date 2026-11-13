// Deploy the kiosk to the Surface over the home network: `npm run deploy` (builds first) or
// `npm run deploy -- --no-build` (ships the exe already in dist/). `--force` installs even if it
// isn't newer than what the tablet runs (a deliberate rollback / re-deploy).
//
// Where to: `deploy.local` in the repo root (gitignored, never commit it), JSON:
//   { "target": "\\\\192.168.1.50\\dist", "health": "http://192.168.1.50:8420/api/health" }
// `target` = the shared folder the kiosk's "OpenSkyLight 0.8.0.exe" runs from; `health` is optional
// (defaults to the target's host on the companion port 8420).
//
// It copies the exe in as OpenSkyLight-next.exe (via a .part file, so the tablet never sees half
// a file), writes next.json (version + SHA-256) LAST, then waits for the tablet to install it:
// the kiosk swaps itself (src/main/deploy/), keeping the old exe as "…prev.exe" for rollback.
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, createReadStream, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const build = !args.includes('--no-build')
const force = args.includes('--force')
// testing overrides: --target <folder> --health <url> --wait <seconds>
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const configPath = join(root, 'deploy.local')
if (!opt('--target') && !existsSync(configPath)) {
  console.error(`No ${configPath}. Create it with {"target": "\\\\\\\\<tablet>\\\\<share>"} (it's gitignored).`)
  process.exit(1)
}
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {}
const target = opt('--target') ?? config.target
if (!target) throw new Error('deploy.local has no "target"')
const host = /^\\\\/.test(target) ? target.replace(/^\\\\/, '').split('\\')[0] : '127.0.0.1'
const health = opt('--health') ?? config.health ?? `http://${host}:8420/api/health`
const waitMs = Number(opt('--wait') ?? 300) * 1000

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (build) execSync('npm run dist', { cwd: root, stdio: 'inherit' })

const exe = join(root, 'dist', 'OpenSkyLight 0.8.0.exe')
if (!existsSync(exe)) throw new Error(`No ${exe}: run npm run dist first (or drop --no-build)`)
// never ship a stale exe: the app inside the build must be this version
const asar = createRequire(join(root, 'package.json'))('@electron/asar')
const built = JSON.parse(asar.extractFile(join(root, 'dist', 'win-unpacked', 'resources', 'app.asar'), 'package.json').toString()).version
if (built !== version) throw new Error(`dist/ holds ${built}, package.json says ${version}: rebuild before deploying`)

if (!existsSync(target)) {
  throw new Error(
    `Can't reach ${target}. Sign in to the share once: cmdkey /add:${host} /user:<tablet user> /pass  (then try again)`
  )
}

const sha256 = await new Promise((res, rej) => {
  const h = createHash('sha256')
  createReadStream(exe).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej)
})
const file = 'OpenSkyLight-next.exe'
const part = join(target, `${file}.part`)
const mb = (statSync(exe).size / 1048576).toFixed(0)
console.log(`Copying ${version} (${mb} MB) to ${target} …`)
const t0 = Date.now()
rmSync(part, { force: true })
copyFileSync(exe, part)
rmSync(join(target, file), { force: true })
renameSync(part, join(target, file))
// the manifest goes last: the tablet acts on it only once the exe is fully there
writeFileSync(join(target, 'next.json'), JSON.stringify({ version, file, sha256, force }, null, 2))
console.log(`Copied in ${((Date.now() - t0) / 1000).toFixed(0)} s. Waiting for the tablet to install it …`)

async function tabletVersion() {
  try {
    const r = await fetch(health, { signal: AbortSignal.timeout(3000) })
    return r.ok ? (await r.json()).version : null
  } catch {
    return null
  }
}

const manifest = join(target, 'next.json')
const deadline = Date.now() + waitMs
let picked = false
let last = ''
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 3000))
  if (existsSync(join(target, 'next.ignored.json')) && !existsSync(manifest)) {
    console.error('✗ The tablet ignored it (not newer, or the checksum failed). See deploy.log in its userData. Use --force to re-deploy the same version.')
    process.exit(1)
  }
  if (!picked && !existsSync(manifest)) {
    picked = true
    console.log('  … the tablet picked it up and is restarting')
  }
  const v = await tabletVersion()
  if (v && v !== last) {
    last = v
    if (picked) console.log(`  … tablet answers: ${v}`)
  }
  if (picked && v === version) {
    console.log(`✓ The Surface is running ${version}`)
    process.exit(0)
  }
}
console.error(
  picked
    ? `✗ The tablet took it but isn't answering as ${version} yet (it rolls back on its own after 2 min if the new one fails; check deploy.log in its %APPDATA%\\OpenSkyLight). Health: ${health}`
    : `✗ The tablet hasn't picked it up in 5 min. Is the kiosk running from ${target}, and is it 0.8.183 or newer (the first one goes on by hand)?`
)
process.exit(1)
