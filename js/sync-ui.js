/* Sincronización desde la interfaz: auto-sync tras cambios, sync manual y en segundo plano. */
import * as db from './db.js';
import { syncNow } from './sync.js';
import { flushQueue } from './notify.js';
import { state, G } from './state.js';
import { $, toast, updateSyncBadge } from './ui.js';
import { refreshKeepingScroll } from './nav.js';
import { logEvent } from './diag.js';
import { openDiagModal } from './modals/diag.js';

export const POLL_MS = 60 * 1000; // Con la app visible, traer cambios de los grupos cada minuto.

export let autoSyncTimer = null;

export let pollTimer = null;

export const syncing = new Map(); // groupId → Promise de la sincronización en curso (evita solapes).

export function scheduleAutoSync() {
  const g = G();
  if (!g || !g.autoSync || !g.syncUrl) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => doSync(true, g.id), 1500);
}

export async function doSync(silent = false, groupId = G() && G().id) {
  const group = state.settings.groups.find((g) => g.id === groupId);
  if (!group || !group.syncUrl) {
    if (!silent) toast('Este grupo no tiene Google Sheets conectado (pestaña Grupo)', 'err');
    return;
  }
  if (syncing.has(groupId)) {
    // En segundo plano basta con la que ya está en marcha. Si la pide la persona (p. ej. tras
    // cambiar la URL), se espera a que acabe y se hace otra con la configuración actual.
    if (silent) return syncing.get(groupId);
    await syncing.get(groupId).catch(() => {});
    return doSync(silent, groupId);
  }
  const isActive = () => G() && G().id === groupId;
  const btn = $('#btn-sync');
  if (isActive()) btn.classList.add('is-spinning');
  const p = (async () => {
    try {
      const res = await syncNow(group);
      delete state.syncErrors[groupId];
      state.settings = await db.getSettings();
      if (!silent) toast(`Sincronizado (${res.pulled} recibidos)`, 'ok');
      // En segundo plano solo repintamos si llegó algo al grupo que se ve.
      if (isActive() && (!silent || res.pulled > 0)) await refreshKeepingScroll();
      return res;
    } catch (err) {
      state.syncErrors[groupId] = err.message;
      logEvent({ kind: 'sync', group: group.name, message: err.message, detail: err.detail });
      if (!silent) toast('Error al sincronizar: ' + err.message, 'err', { action: { label: 'Detalles', fn: openDiagModal } });
      console.warn('Sync error', group.name, err);
    } finally {
      updateSyncBadge();
      syncing.delete(groupId);
      if (![...syncing.keys()].some((id) => G() && id === G().id)) btn.classList.remove('is-spinning');
    }
  })();
  syncing.set(groupId, p);
  return p;
}

/* Sincroniza todos los grupos al abrir la app, al volver a ella, al
 * recuperar la red y periódicamente mientras está visible. */
export function startBackgroundSync() {
  const tick = () => {
    flushQueue().catch(() => {});
    for (const g of state.settings.groups) if (g.syncUrl && g.autoSync) doSync(true, g.id);
  };
  const startPoll = () => { clearInterval(pollTimer); pollTimer = setInterval(tick, POLL_MS); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { tick(); startPoll(); }
    else clearInterval(pollTimer);
  });
  window.addEventListener('online', tick);
  tick();
  startPoll();
}
