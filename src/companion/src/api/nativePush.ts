import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

/**
 * The Android app's own notifications plugin (android/app/src/main/java/…/push/FamilySkyviewPushPlugin.java).
 * The kiosk sends alerts through Firebase Cloud Messaging; this side only hands over the token and
 * hears about taps. Only exists inside Family Skyview: check isNativeApp() first.
 */
export interface FamilySkyviewPush {
  checkPermissions(): Promise<{ notifications: PermissionState }>
  /** Android 13+ asks; older phones just report whether notifications are on for the app */
  requestPermissions(): Promise<{ notifications: PermissionState }>
  /** rejects with code NO_FIREBASE when the build has no google-services.json */
  getToken(): Promise<{ token: string; endpoint: string }>
  deleteToken(): Promise<void>
  addListener(event: 'tokenRefresh', fn: (e: { token: string; endpoint: string }) => void): Promise<PluginListenerHandle>
  /** a notification was tapped (kept until a listener takes it, so a cold start still gets it) */
  addListener(event: 'openTab', fn: (e: { tab: string; key: string | null }) => void): Promise<PluginListenerHandle>
}

export const NativePush = registerPlugin<FamilySkyviewPush>('FamilySkyviewPush')
