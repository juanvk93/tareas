/* Service Worker — Tareas del Hogar
 * Estrategia: cache-first para el "app shell" (mismo origen), la red se ignora
 * para peticiones cross-origin (sincronización con Google Apps Script y avisos a ntfy).
 *
 * IMPORTANTE: al publicar una versión nueva, sube CACHE_VERSION para forzar
 * la actualización de la caché en los dispositivos. Debe coincidir con la
 * versión declarada en js/changelog.js.
 */
const CACHE_VERSION = 'v2.1.0';
const CACHE_NAME = `tareas-hogar-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/sync.js',
  './js/changelog.js',
  './js/icons.js',
  './js/notify.js',
  './js/dates.js',
  './js/catalog.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] Fallo al precargar el shell:', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo gestionamos GET del mismo origen. Todo lo demás (sincronización con
  // Google, POST, etc.) va directo a la red sin tocar la caché.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // Cache-first, pero refrescamos en segundo plano (stale-while-revalidate).
        fetch(req).then((res) => {
          if (res && res.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
