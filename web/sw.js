// Tourne en arrière-plan : garde l'app disponible et reçoit les notifications.
const CACHE = 'alertes-pm-v1';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'styles.css', 'manifest.webmanifest', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Réseau d'abord, pour toujours montrer les dernières offres. Le cache sert hors connexion.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match('./'))),
  );
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Nouvelle offre', {
      body: data.body ?? '',
      icon: 'icons/icon-192.png',
      data: { url: new URL(data.url ?? './', self.registration.scope).href },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const client = clients[0];
      if (!client) return self.clients.openWindow(target);
      await client.focus();
      client.postMessage({ type: 'open', url: target });
    }),
  );
});
