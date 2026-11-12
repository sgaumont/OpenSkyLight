import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { isNewer } from '@shared/appVersion'
import { isNativeApp, kioskFetch } from './base'

/**
 * Family Skyview updates itself from the tablet: every tablet build carries the matching APK
 * (GET /app/family-skyview.apk), and GET /api/app-info says which version that is.
 * Native side: android/app/src/main/java/…/update/FamilySkyviewUpdatePlugin.java.
 */
interface FamilySkyviewUpdate {
  getVersion(): Promise<{ version: string; code: number }>
  install(opts: { path: string }): Promise<{ started?: boolean; needsPermission?: boolean }>
  addListener(event: 'downloadProgress', fn: (e: { percent: number }) => void): Promise<PluginListenerHandle>
}

const NativeUpdate = registerPlugin<FamilySkyviewUpdate>('FamilySkyviewUpdate')

export interface TabletApp {
  version: string
  sizeBytes: number
  path: string
}

/** The Android app this tablet hands out, or null (an older tablet build, or one without it). */
export async function tabletApp(): Promise<TabletApp | null> {
  try {
    const res = await kioskFetch('/api/app-info', { cache: 'no-store' })
    if (!res.ok) return null
    return ((await res.json()) as { android: TabletApp | null }).android
  } catch {
    return null
  }
}

export async function appVersion(): Promise<string | null> {
  if (!isNativeApp()) return null
  return NativeUpdate.getVersion()
    .then((v) => v.version)
    .catch(() => null)
}

/** The tablet's app when it's newer than this one (Android app only). */
export async function availableUpdate(): Promise<TabletApp | null> {
  const mine = await appVersion()
  if (!mine) return null
  const theirs = await tabletApp()
  return theirs && isNewer(theirs.version, mine) ? theirs : null
}

/**
 * Downloads the tablet's APK and opens Android's "Update this app?" prompt. 'permission' = Android
 * just showed the "Install unknown apps" switch for Family Skyview: allow it, then try again.
 */
export async function installUpdate(path: string, onProgress: (percent: number) => void): Promise<'started' | 'permission'> {
  const listener = await NativeUpdate.addListener('downloadProgress', (e) => onProgress(e.percent))
  try {
    const r = await NativeUpdate.install({ path })
    return r.needsPermission ? 'permission' : 'started'
  } finally {
    void listener.remove()
  }
}
