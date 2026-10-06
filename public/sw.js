// Service worker for push notifications. Registered from app.js at scope
// '/', so it can receive push events for the whole origin.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Quantum Secure Transaction Desk', body: 'You have a new message.', url: '/' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (e) { /* use defaults */ }

  event.waitUntil(Promise.all([
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
      tag: 'qsd-message',
      renotify: true,
      requireInteraction: true,
      vibrate: [220, 110, 220, 110, 220]
    }),
    // Any open (even backgrounded) tab is told to play its 3x alert sound.
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => list.forEach((c) => c.postMessage({ type: 'push-sound', title: data.title, body: data.body })))
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
