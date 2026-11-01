/* Service Worker — Tareas del Hogar
 * Estrategia: cache-first por versión para el "app shell" (mismo origen), la red se ignora
 * para peticiones cross-origin (sincronización con Google Apps Script y avisos a ntfy).
 *
 * IMPORTANTE: al publicar una versión nueva, sube CACHE_VERSION para forzar
 * la actualización de la caché en los dispositivos. Debe coincidir con la
 * versión declarada en js/changelog.js.
 */
const CACHE_VERSION = 'v3.2.0';
const CACHE_NAME = `tareas-hogar-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/state.js',
  './js/ui.js',
  './js/nav.js',
  './js/actions.js',
  './js/sync-ui.js',
  './js/groups.js',
  './js/views/parts.js',
  './js/views/onboarding.js',
  './js/views/hoy.js',
  './js/views/proximas.js',
  './js/views/hechas.js',
  './js/views/grupo.js',
  './js/views/ajustes.js',
  './js/modals/todo.js',
  './js/modals/catalog.js',
  './js/modals/guides.js',
  './js/modals/news.js',
  './js/modals/diag.js',
  './js/modals/routine.js',
  './js/diag.js',
  './js/update.js',
  './js/db.js',
  './js/sync.js',
  './js/changelog.js',
  './js/icons.js',
  './js/notify.js',
  './js/dates.js',
  './js/catalog.js',
  './js/parse.js',
  './apps-script/Code.gs',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-maskable-512.png'
];

// Todo el shell sale de la red sin pasar por la caché HTTP del navegador
// (cache: 'reload'): GitHub Pages cachea 10 min y, si no, una versión podía
// quedar con app.js nuevo y algún módulo viejo, y la app no arrancaba.
// Si falla alguna descarga, la instalación falla y sigue la versión anterior.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
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

  // Cache-first estricto: cada versión sirve SOLO sus archivos (nada de
  // refrescar sueltos en segundo plano, que mezclaba versiones). Lo nuevo
  // llega al subir CACHE_VERSION. ignoreSearch: './index.html?x' = shell.
  event.respondWith(
    caches.open(CACHE_NAME)
      .then((cache) => cache.match(req, { ignoreSearch: true }))
      .then((cached) => cached || fetch(req).catch(() =>
        req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  );
});
