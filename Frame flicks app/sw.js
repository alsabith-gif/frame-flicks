// sw.js — service worker. Its only job is to receive push messages from the
// server and show them as notifications (even when the app is closed), and
// to open the app on the Calendar when a notification is tapped. It does no
// caching, so it can never serve you a stale copy of the app.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Frame Flicks';
  // iOS requires every push to show a notification, so always call this.
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: 'assets/icon-512.png',
    tag: data.tag || undefined,
    data: { url: data.url || './index.html?page=calendar' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './index.html?page=calendar', self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(target); } catch (e) { /* ignore */ } }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
