// Phone notifications from the kiosk (Web Push). Only shows them and opens the app on a tap —
// no caching, so the companion still always loads fresh from the kiosk.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'OpenSkyLight', body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'OpenSkyLight', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // a chat message sent Quiet still shows, without a sound or vibration
      silent: data.silent === true,
      data: { url: data.url || '/' }
    })
  )
})

// a tap opens the matching tab: in the app if it's already open, otherwise a fresh window
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((w) => new URL(w.url).origin === url.origin)
      if (open) {
        open.postMessage({ type: 'open-tab', tab: url.searchParams.get('tab') })
        return open.focus()
      }
      return self.clients.openWindow(url.href)
    })()
  )
})
