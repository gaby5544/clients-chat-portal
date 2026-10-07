// Service worker for push notifications. Registered from app.js at scope
// '/', so it can receive push events for the whole origin.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A fetch handler (plain pass-through, no caching) is what lets browsers offer "Install app".
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let data = { title: 'Quantum Secure Transaction Desk', body: 'You have a new message.', url: '/' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (e) { /* use defaults */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
      tag: data.tag || 'qsd-message',
      renotify: true,
      requireInteraction: !!data.requireInteraction,
      vibrate: [220, 110, 220, 110, 220],   // three pulses on devices that support it
      silent: false
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) { client.postMessage({ type: 'open-url', url: targetUrl }); return client.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
