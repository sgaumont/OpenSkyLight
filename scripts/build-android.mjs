// Builds the Android app (Family Skyview) → dist/Family-Skyview-<version>.apk, ready to sideload.
// Steps: phone UI (vite) → copy into the Android project (cap sync) → Gradle debug build.
// Needs JDK 21 and the Android SDK (see CLAUDE.md, "Android app"). Debug-signed for now; a release
// signing key comes with the CI build.
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function findJdk21() {
  const home = process.env.JAVA_HOME
  if (home && existsSync(join(home, 'release')) && /JAVA_VERSION="2[1-9]/.test(readFileSync(join(home, 'release'), 'utf8'))) return home
  for (const dir of ['C:\\Program Files\\Microsoft', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java']) {
    if (!existsSync(dir)) continue
    const jdk = readdirSync(dir).filter((d) => /^jdk-?2[1-9]/.test(d)).sort().pop()
    if (jdk) return join(dir, jdk)
  }
  throw new Error('JDK 21 not found — install it (winget install Microsoft.OpenJDK.21) or set JAVA_HOME')
}

const sdk = process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk')
if (!existsSync(sdk)) throw new Error(`Android SDK not found at ${sdk} — set ANDROID_HOME`)
// the build machine's default Java may be another version (e.g. 11 for other projects): only Gradle gets 21
const env = { ...process.env, JAVA_HOME: findJdk21(), ANDROID_HOME: sdk }
const run = (cmd, cwd = root) => execSync(cmd, { cwd, env, stdio: 'inherit' })

run('npm run build:companion')
run('npx cap sync android')
run(process.platform === 'win32' ? '.\\gradlew.bat assembleDebug' : './gradlew assembleDebug', join(root, 'android'))

const apk = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
mkdirSync(join(root, 'dist'), { recursive: true })
const out = join(root, 'dist', `Family-Skyview-${version}.apk`)
copyFileSync(apk, out)
console.log(`\nAndroid app: ${out}`)
