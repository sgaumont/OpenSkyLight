import type { PushPrefs } from '@shared/pushAlerts'
import { rpc } from './client'
import { isNativeApp } from './base'
import { NativePush } from './nativePush'
import { getPhoneName } from '../lib/phoneName'

/**
 * Phone notifications, two ways to the same kiosk settings:
 * - the phone web app uses Web Push, which phones only allow on a secure page — so from the kiosk's
 *   Tailscale https address, not the home Wi-Fi http one;
 * - the Android app (Family Skyview) gets native notifications through Firebase Cloud Messaging; the
 *   kiosk knows it as the endpoint "fcm:<token>".
 * Either way this phone is one `PushHandle`, keyed on the kiosk by its endpoint.
 */
export interface PushHandle {
  endpoint: string
  /** the browser's subscription (web app only) */
  web: PushSubscription | null
}

function webPushSupported(): boolean {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function pushSupported(): boolean {
  return isNativeApp() || webPushSupported()
}

/** The web app's notifications helper (public/sw.js); registered once, at start-up, where it's supported. */
export function registerServiceWorker(): void {
  if (isNativeApp() || !webPushSupported()) return
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[push] service worker', e))
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready
}

/**
 * This phone's push address, if it has one. On Android that's its FCM token (whether or not the
 * kiosk has it yet: ask notify:get); on the web, the browser's subscription when notifications are on.
 */
export async function currentSubscription(): Promise<PushHandle | null> {
  if (isNativeApp()) {
    const t = await NativePush.getToken().catch(() => null)
    return t ? { endpoint: t.endpoint, web: null } : null
  }
  if (!webPushSupported()) return null
  const sub = await (await registration()).pushManager.getSubscription()
  return sub ? { endpoint: sub.endpoint, web: sub } : null
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Asks the phone's permission (must follow a tap), subscribes, and tells the kiosk. */
export async function enablePush(personId: string | null, prefs: PushPrefs): Promise<PushHandle> {
  if (isNativeApp()) {
    const { notifications } = await NativePush.requestPermissions()
    if (notifications !== 'granted') {
      throw new Error("Notifications are off for Family Skyview. Turn them on in the phone's Settings → Apps → Family Skyview → Notifications.")
    }
    const { token } = await NativePush.getToken().catch((e: { code?: string; message?: string }) => {
      throw new Error(
        e.code === 'NO_FIREBASE'
          ? "This copy of Family Skyview was built without its Firebase file, so it can't get notifications."
          : `Couldn't turn on notifications: ${e.message ?? 'no push token'}`
      )
    })
    return saveNative(token, personId, prefs)
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site in the phone settings')
  const { publicKey } = await rpc('notify:publicKey', undefined)
  const reg = await registration()
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }))
  const handle = { endpoint: sub.endpoint, web: sub }
  await savePush(handle, personId, prefs)
  return handle
}

/** Tells the kiosk who this phone is and which alerts it wants. */
export async function savePush(handle: PushHandle, personId: string | null, prefs: PushPrefs): Promise<void> {
  if (!handle.web) {
    await saveNative(tokenOf(handle.endpoint), personId, prefs)
    return
  }
  const json = handle.web.toJSON()
  await rpc('notify:subscribe', {
    endpoint: handle.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
    personId,
    prefs
  })
}

export async function disablePush(handle: PushHandle): Promise<void> {
  await rpc('notify:unsubscribe', { endpoint: handle.endpoint }).catch(() => undefined)
  if (handle.web) await handle.web.unsubscribe()
  else setSavedEndpoint(null)
}

// ---- Android: keeping the kiosk's copy of this phone's FCM token current ----

/** The endpoint this phone last gave the kiosk, so a new token can take over its settings. */
const FCM_ENDPOINT_KEY = 'osl.fcmEndpoint'

function savedEndpoint(): string | null {
  try {
    return localStorage.getItem(FCM_ENDPOINT_KEY)
  } catch {
    return null
  }
}

function setSavedEndpoint(endpoint: string | null): void {
  try {
    if (endpoint) localStorage.setItem(FCM_ENDPOINT_KEY, endpoint)
    else localStorage.removeItem(FCM_ENDPOINT_KEY)
  } catch {
    // storage blocked: a token change just means turning notifications on again
  }
}

function tokenOf(endpoint: string): string {
  return endpoint.startsWith('fcm:') ? endpoint.slice(4) : endpoint
}

async function saveNative(token: string, personId: string | null, prefs: PushPrefs): Promise<PushHandle> {
  const { endpoint } = await rpc('notify:subscribeFcm', { token, personId, prefs, deviceName: getPhoneName() || null })
  setSavedEndpoint(endpoint)
  return { endpoint, web: null }
}

/**
 * Firebase gave this phone a new token (it does now and then, and after a reinstall or data clear):
 * move the kiosk's settings for the old one over to it, so notifications keep coming.
 */
async function adoptToken(token: string): Promise<void> {
  const old = savedEndpoint()
  if (!old || old === `fcm:${token}`) return
  const saved = await rpc('notify:get', { endpoint: old }).catch(() => null)
  if (!saved) {
    // turned off on the kiosk (or never on): nothing to carry over
    setSavedEndpoint(null)
    return
  }
  await saveNative(token, saved.personId, saved.prefs)
  await rpc('notify:unsubscribe', { endpoint: old }).catch(() => undefined)
}

/**
 * Android app start-up (while paired): catch a token that changed while the app was closed, listen
 * for the next change, and hand over taps on notifications. Returns a stop function.
 */
export function startNativePush(onOpenTab: (tab: string) => void): () => void {
  if (!isNativeApp()) return () => {}
  const handles = [
    NativePush.addListener('tokenRefresh', (e) => void adoptToken(e.token).catch((err) => console.warn('[push] token', err))),
    NativePush.addListener('openTab', (e) => onOpenTab(e.tab))
  ]
  if (savedEndpoint()) {
    void NativePush.getToken()
      .then((t) => adoptToken(t.token))
      .catch(() => undefined)
  }
  return () => handles.forEach((h) => void h.then((x) => x.remove()))
}

/** Unpaired (a 401): this phone stops getting the kiosk's notifications. */
export function forgetNativePush(): void {
  if (!isNativeApp()) return
  setSavedEndpoint(null)
  void NativePush.deleteToken().catch(() => undefined)
}
