/* Service Worker: registro, búsqueda de actualizaciones y aviso de versión nueva.
 *
 * sw.js hace skipWaiting + clients.claim: la versión nueva toma el control en
 * cuanto se instala, pero la página abierta sigue ejecutando el código viejo
 * hasta que se recarga. Por eso se avisa con un toast fijo «Recargar» (no se
 * recarga sola: podría perderse lo que se está escribiendo).
 */
import { logEvent } from './diag.js';
import { toast } from './ui.js';

const CHECK_EVERY_MS = 30 * 60 * 1000; // Al volver a la app, como mucho cada 30 min.

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Si ya había un Service Worker, un cambio de controlador = versión nueva.
  // Sin él es la primera instalación (clients.claim también lo dispara): no se avisa.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) announceUpdate();
  });

  let reg;
  try {
    // updateViaCache 'none': comprobar sw.js siempre en la red (no en la caché HTTP).
    reg = await navigator.serviceWorker.register(new URL('sw.js', window.location.href), { updateViaCache: 'none' });
  } catch (err) {
    console.warn('SW no registrado:', err);
    if (navigator.onLine) logEvent({ kind: 'sw', message: 'No se pudo registrar o actualizar el Service Worker: ' + err.message });
    return;
  }

  // Android deja la PWA abierta días: se busca versión nueva al volver a ella.
  let lastCheck = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - lastCheck < CHECK_EVERY_MS) return;
    lastCheck = Date.now();
    reg.update().catch(() => {});
  });
}

let announced = false;
async function announceUpdate() {
  if (announced) return;
  announced = true;
  // El número sale del changelog.js de la versión nueva (ya está en su caché).
  let version = '';
  try {
    const src = await (await fetch('js/changelog.js')).text();
    version = (src.match(/APP_VERSION = '([^']+)'/) || [])[1] || '';
  } catch { /* sin número: aviso genérico */ }
  toast(version ? `Versión ${version} disponible` : 'Hay una versión nueva', 'ok', {
    persist: true,
    action: { label: 'Recargar', fn: () => location.reload() }
  });
}
