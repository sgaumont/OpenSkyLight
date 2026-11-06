import type { PushPrefs } from '@shared/pushAlerts'
import { rpc } from './client'

/**
 * Phone notifications (Web Push). Phones only allow them on a secure page, so they work from the
 * kiosk's Tailscale https address, not the home Wi-Fi http one.
 */
export function pushSupported(): boolean {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** The notifications helper (public/sw.js); registered once, at start-up, where it's supported. */
export function registerServiceWorker(): void {
  if (!pushSupported()) return
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[push] service worker', e))
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready
}

/** This phone's current push subscription, if notifications are on. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  return (await registration()).pushManager.getSubscription()
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Asks the phone's permission (must follow a tap), subscribes, and tells the kiosk. */
export async function enablePush(personId: string | null, prefs: PushPrefs): Promise<PushSubscription> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site in the phone settings')
  const { publicKey } = await rpc('notify:publicKey', undefined)
  const reg = await registration()
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }))
  await savePush(sub, personId, prefs)
  return sub
}

/** Tells the kiosk who this phone is and which alerts it wants. */
export async function savePush(sub: PushSubscription, personId: string | null, prefs: PushPrefs): Promise<void> {
  const json = sub.toJSON()
  await rpc('notify:subscribe', {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
    personId,
    prefs
  })
}

export async function disablePush(sub: PushSubscription): Promise<void> {
  await rpc('notify:unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined)
  await sub.unsubscribe()
}
