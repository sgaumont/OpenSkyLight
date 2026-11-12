// Builds the Android app (Family Skyview) → dist/Family-Skyview-<version>.apk, ready to sideload.
// Steps: phone UI (vite) → copy into the Android project (cap sync) → Gradle build.
// Needs JDK 21 and the Android SDK (see CLAUDE.md, "Android app").
//
// Release-signed when the signing settings exist (FAMILY_SKYVIEW_SIGNING, or
// %USERPROFILE%\.familyskyview\signing.properties — see android/app/build.gradle); debug otherwise.
//   --bundle   also put the APK where electron-builder packs it into the tablet build
//              (build/family-skyview/), so the tablet can hand it out (`npm run dist` does this)
//   --require  fail instead of skipping when the release key or google-services.json is missing (CI)
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const bundle = process.argv.includes('--bundle')
const strict = process.argv.includes('--require')

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

const bundleDir = join(root, 'build', 'family-skyview')
// never pack a stale APK: the folder only ever holds this build's
rmSync(bundleDir, { recursive: true, force: true })
mkdirSync(bundleDir, { recursive: true }) // electron-builder's extraResources wants it to exist

const signingFile = process.env.FAMILY_SKYVIEW_SIGNING || join(homedir(), '.familyskyview', 'signing.properties')
const signed = existsSync(signingFile)
const firebase = existsSync(join(root, 'android', 'app', 'google-services.json'))
const problems = [
  !signed && `no release signing settings (${signingFile})`,
  !firebase && 'no android/app/google-services.json, so the app would get no notifications'
].filter(Boolean)
if (problems.length && (strict || bundle)) {
  const msg = `Family Skyview: ${problems.join('; ')}`
  if (strict) throw new Error(msg)
  // a tablet build without the app still works: Settings says so, and phones keep the app they have
  console.warn(`\n⚠️  ${msg}. The tablet build will NOT include the Android app.\n`)
  process.exit(0)
}

const sdk = process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk')
if (!existsSync(sdk)) throw new Error(`Android SDK not found at ${sdk} — set ANDROID_HOME`)
// the build machine's default Java may be another version (e.g. 11 for other projects): only Gradle gets 21
const env = { ...process.env, JAVA_HOME: findJdk21(), ANDROID_HOME: sdk }
const run = (cmd, cwd = root) => execSync(cmd, { cwd, env, stdio: 'inherit' })

run('npm run build:companion')
run('npx cap sync android')
const task = signed ? 'assembleRelease' : 'assembleDebug'
run(process.platform === 'win32' ? `.\\gradlew.bat ${task}` : `./gradlew ${task}`, join(root, 'android'))

const apk = signed
  ? join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
  : join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
mkdirSync(join(root, 'dist'), { recursive: true })
const out = join(root, 'dist', `Family-Skyview-${version}.apk`)
copyFileSync(apk, out)
console.log(`\nAndroid app (${signed ? 'release-signed' : 'DEBUG-signed: phones can only update it from this PC'}): ${out}`)

if (bundle) {
  mkdirSync(bundleDir, { recursive: true })
  copyFileSync(apk, join(bundleDir, 'Family-Skyview.apk'))
  writeFileSync(join(bundleDir, 'family-skyview.json'), JSON.stringify({ version, file: 'Family-Skyview.apk' }, null, 2))
  console.log(`Packed into the tablet build: ${bundleDir}`)
}
