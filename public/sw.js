// Service worker: push notifications + a fast, safe asset cache.
// HTML pages are NEVER cached (so an expired invite link can never be served from the cache); static assets
// (icons, flags, fonts, scripts) are cached after first use so the installed app opens quickly.
const CACHE = 'vistra-assets-v39';
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/offline.html', '/icon-192.png', '/icon-512.png'])).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const keys = await caches.keys(); await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Pages are never cached (an expired invite link must never be served from cache); if the network is down show the offline page.
  if (req.mode === 'navigate' && url.origin === self.location.origin) { event.respondWith(fetch(req).catch(() => caches.match('/offline.html'))); return; }
  if (url.origin !== self.location.origin || url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  const isAsset = /\.(?:png|svg|woff2?|css|js|webmanifest|bin|json)$/.test(url.pathname);
  if (!isAsset) return;
  const immutable = url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/icon-');
  event.respondWith((async () => {
    const cache = await caches.open(CACHE); const hit = await cache.match(req);
    if (hit && immutable) return hit;
    try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; }
    catch (e) { if (hit) return hit; throw e; }
  })());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Vistra', body: 'You have a new message.', url: '/' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (e) { /* use defaults */ }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url || '/' },
    tag: data.tag || 'qsd-message', renotify: true, requireInteraction: !!data.requireInteraction,
    vibrate: [220, 110, 220, 110, 220], silent: false
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) { if (client.url.includes(self.location.origin) && 'focus' in client) { client.postMessage({ type: 'open-url', url: targetUrl }); return client.focus(); } }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  }));
});
