// Runs after `npm run dist`: renames the portable exe to the fixed file name the
// kiosk's autorun points at (overwriting the previous one), and clears out
// installers left over from older versions so dist/ holds one of each.
import { readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'

const KIOSK_NAME = 'OpenSkyLight 0.8.0.exe'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
renameSync(`dist/OpenSkyLight ${version}.exe`, `dist/${KIOSK_NAME}`)

for (const file of readdirSync('dist')) {
  const stale = /^OpenSkyLight .*\.exe(\.blockmap)?$/.test(file) && file !== KIOSK_NAME && !file.includes(version)
  if (stale) rmSync(`dist/${file}`)
}
console.log(`Kiosk exe: dist/${KIOSK_NAME} (app version ${version})`)
