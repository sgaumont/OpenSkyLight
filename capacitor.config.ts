import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Family Skyview — the Android app wrapping the phone companion (src/companion, built to
 * out/companion). The kiosk app's own name/appId (OpenSkyLight) are separate and never change.
 */
const config: CapacitorConfig = {
  appId: 'io.github.sgaumont.familyskyview',
  appName: 'Family Skyview',
  webDir: 'out/companion',
  server: {
    // the bundled UI runs at https://localhost (the kiosk allows that origin)…
    androidScheme: 'https',
    // …and calls the kiosk over plain http on the home Wi-Fi
    cleartext: true
  },
  android: {
    allowMixedContent: true
  }
}

export default config
