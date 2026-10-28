/* Capa de datos sobre IndexedDB.
 *
 * Almacenes (object stores):
 *   - members  : personas del hogar        {id, name, color, emoji, updatedAt, deleted}
 *   - tasks    : catálogo de tareas         {id, name, icon, points, updatedAt, deleted}
 *                (los registros de la v1.0.0 llevan `emoji` en vez de `icon`; ver icons.js)
 *   - log      : registro de realizadas     {id, taskId, memberId, ts, points, note, updatedAt, deleted}
 *   - schedule : planificación semanal       {id, weekKey, day, taskId, memberId, updatedAt, deleted}
 *   - meta     : ajustes/config              {key, value}
 *
 * Los borrados son "blandos" (deleted:true + updatedAt) para poder
 * sincronizarlos entre dispositivos (tombstones). La interfaz filtra los
 * registros con deleted:true.
 */

const DB_NAME = 'tareas-hogar';
const DB_VERSION = 1;
export const DATA_STORES = ['members', 'tasks', 'log', 'schedule'];

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const s of DATA_STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return _db.transaction(store, mode).objectStore(store);
}
function reqToPromise(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

/* ---------------------------- CRUD genérico ------------------------------ */
export async function getAllRaw(store) {
  await openDB();
  return reqToPromise(tx(store).getAll());
}
export async function getActive(store) {
  const all = await getAllRaw(store);
  return all.filter((r) => !r.deleted);
}
export async function getOne(store, id) {
  await openDB();
  return reqToPromise(tx(store, 'readonly').get(id));
}
export async function putRaw(store, record) {
  await openDB();
  return reqToPromise(tx(store, 'readwrite').put(record));
}
export async function clearStore(store) {
  await openDB();
  return reqToPromise(tx(store, 'readwrite').clear());
}

/* ------------------------------- Ajustes --------------------------------- */
const DEFAULT_SETTINGS = {
  accent: '#4f8cff',
  theme: 'dark',
  syncUrl: '',
  syncSecret: '',
  currentMemberId: null,
  autoSync: true,
  lastSyncAt: 0,
  // Notificaciones (ntfy)
  notifyEnabled: false,
  ntfyServer: 'https://ntfy.sh',
  ntfyTopic: ''
};

export async function getSettings() {
  await openDB();
  const rec = await reqToPromise(tx('meta').get('settings'));
  return Object.assign({}, DEFAULT_SETTINGS, rec ? rec.value : {});
}
export async function saveSettings(patch) {
  const current = await getSettings();
  const value = Object.assign({}, current, patch);
  await reqToPromise(tx('meta', 'readwrite').put({ key: 'settings', value }));
  return value;
}

/* --------------------------- Utilidades varias --------------------------- */
export function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/* --------------------- Operaciones de alto nivel ------------------------- */
// Personas
export async function addMember({ name, color, emoji }) {
  const rec = { id: uid(), name: name.trim(), color, emoji: emoji || '', updatedAt: Date.now(), deleted: false };
  await putRaw('members', rec);
  return rec;
}
export async function updateMember(id, patch) {
  const rec = await getOne('members', id);
  if (!rec) return null;
  Object.assign(rec, patch, { updatedAt: Date.now() });
  await putRaw('members', rec);
  return rec;
}
export async function deleteMember(id) {
  const rec = await getOne('members', id);
  if (!rec) return;
  rec.deleted = true; rec.updatedAt = Date.now();
  await putRaw('members', rec);
}
export function members() { return getActive('members'); }

// Tareas (catálogo)
export async function addTask({ name, icon, points }) {
  const rec = { id: uid(), name: name.trim(), icon: icon || 'sparkles', points: Number(points) || 1, updatedAt: Date.now(), deleted: false };
  await putRaw('tasks', rec);
  return rec;
}
export async function updateTask(id, patch) {
  const rec = await getOne('tasks', id);
  if (!rec) return null;
  Object.assign(rec, patch, { updatedAt: Date.now() });
  await putRaw('tasks', rec);
  return rec;
}
export async function deleteTask(id) {
  const rec = await getOne('tasks', id);
  if (!rec) return;
  rec.deleted = true; rec.updatedAt = Date.now();
  await putRaw('tasks', rec);
}
export function tasks() { return getActive('tasks'); }

// Registro de tareas realizadas
export async function logCompletion({ taskId, memberId, ts, points, note }) {
  const rec = {
    id: uid(), taskId, memberId,
    ts: ts || Date.now(),
    points: Number(points) || 0,
    note: note || '',
    updatedAt: Date.now(), deleted: false
  };
  await putRaw('log', rec);
  return rec;
}
export async function deleteLog(id) {
  const rec = await getOne('log', id);
  if (!rec) return;
  rec.deleted = true; rec.updatedAt = Date.now();
  await putRaw('log', rec);
}
export function logs() { return getActive('log'); }

// Planificación semanal
export async function addAssignment({ weekKey, day, taskId, memberId }) {
  const rec = { id: uid(), weekKey, day, taskId, memberId, updatedAt: Date.now(), deleted: false };
  await putRaw('schedule', rec);
  return rec;
}
export async function deleteAssignment(id) {
  const rec = await getOne('schedule', id);
  if (!rec) return;
  rec.deleted = true; rec.updatedAt = Date.now();
  await putRaw('schedule', rec);
}
export function assignments() { return getActive('schedule'); }

/* ------------------- Almacenamiento persistente -------------------------- */
export async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return { supported: false, persisted: false };
  const already = await navigator.storage.persisted();
  const persisted = already ? true : await navigator.storage.persist();
  return { supported: true, persisted };
}
export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  const est = await navigator.storage.estimate();
  return est;
}

/* --------------------- Exportar / importar (backup) ---------------------- */
export async function exportAll() {
  const data = {};
  for (const s of DATA_STORES) data[s] = await getAllRaw(s);
  const settings = await getSettings();
  // No exportamos claves de sincronización ni el tema de ntfy por seguridad;
  // el usuario las reintroduce (o usa "Compartir configuración").
  const safeSettings = Object.assign({}, settings, { syncUrl: '', syncSecret: '', ntfyTopic: '' });
  return { app: 'tareas-hogar', exportedAt: Date.now(), stores: data, settings: safeSettings };
}
export async function importAll(payload, { merge = true } = {}) {
  if (!payload || !payload.stores) throw new Error('Archivo no válido');
  for (const s of DATA_STORES) {
    const incoming = payload.stores[s] || [];
    if (!merge) await clearStore(s);
    for (const rec of incoming) {
      if (merge) {
        const existing = await getOne(s, rec.id);
        if (existing && (existing.updatedAt || 0) >= (rec.updatedAt || 0)) continue;
      }
      await putRaw(s, rec);
    }
  }
}
