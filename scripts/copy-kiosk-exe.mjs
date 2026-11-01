// Runs after `npm run dist`: copies the portable exe to kiosk/ under the fixed
// file name the kiosk's autorun points at, so a new build is a drop-in replacement.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'

const KIOSK_NAME = 'OpenSkyLight 0.8.0.exe'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const source = `dist/OpenSkyLight ${version}.exe`
mkdirSync('kiosk', { recursive: true })
copyFileSync(source, `kiosk/${KIOSK_NAME}`)
console.log(`Kiosk exe: ${source} -> kiosk/${KIOSK_NAME} (app version ${version})`)
