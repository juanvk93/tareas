/* Capa de datos sobre IndexedDB.
 *
 * Almacenes (object stores) que se sincronizan con el grupo:
 *   - members : miembros del grupo   {id, name, color, updatedAt, deleted}
 *   - todos   : tareas pendientes    {id, title, icon, dueDate, repeat, assignee, note,
 *                                     done, doneAt, doneBy, createdBy, createdAt,
 *                                     seriesId, updatedAt, deleted}
 * Y uno local:
 *   - meta    : ajustes/config       {key, value}
 *
 * Los almacenes tasks/log/schedule de la v1.x se conservan sin usar (no se
 * borran datos al actualizar), pero ya no se leen ni se sincronizan.
 *
 * Los borrados son "blandos" (deleted:true + updatedAt) para poder
 * sincronizarlos entre dispositivos (tombstones). La interfaz filtra los
 * registros con deleted:true.
 */
import { nextDue } from './dates.js';

const DB_NAME = 'tareas-hogar';
const DB_VERSION = 2;
export const DATA_STORES = ['members', 'todos'];
const LEGACY_STORES = ['tasks', 'log', 'schedule'];

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const s of [...DATA_STORES, ...LEGACY_STORES]) {
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
  lastSeenVersion: '', // Última versión cuyas novedades se mostraron en este móvil.
  // Grupo
  groupName: '',
  currentMemberId: null,
  syncUrl: '',
  syncSecret: '',
  autoSync: true,
  lastSyncAt: 0,
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

/* --------------------------- Miembros del grupo -------------------------- */
export async function addMember({ name, color }) {
  const rec = { id: uid(), name: name.trim(), color, updatedAt: Date.now(), deleted: false };
  await putRaw('members', rec);
  return rec;
}
export async function updateMember(id, patch) {
  const rec = await getOne('members', id);
  if (!rec) return null;
  Object.assign(rec, patch, { deleted: false, updatedAt: Date.now() });
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

/* ---------------------------- Tareas pendientes -------------------------- */
export async function addTodo({ title, icon, dueDate, repeat, assignee, note, createdBy }) {
  const id = uid();
  const rec = {
    id, title: title.trim(), icon: icon || 'sparkles', dueDate,
    repeat: repeat || 'none', assignee: assignee || null, note: note || '',
    done: false, doneAt: 0, doneBy: null,
    createdBy: createdBy || null, createdAt: Date.now(),
    seriesId: id,
    updatedAt: Date.now(), deleted: false
  };
  await putRaw('todos', rec);
  return rec;
}
export async function updateTodo(id, patch) {
  const rec = await getOne('todos', id);
  if (!rec) return null;
  Object.assign(rec, patch, { updatedAt: Date.now() });
  await putRaw('todos', rec);
  return rec;
}
export async function deleteTodo(id) {
  const rec = await getOne('todos', id);
  if (!rec) return;
  rec.deleted = true; rec.updatedAt = Date.now();
  await putRaw('todos', rec);
}
export function todos() { return getActive('todos'); }

/** Id determinista de la siguiente repetición: si los dos móviles resuelven
 * la misma tarea a la vez, generan el mismo registro y no se duplica. */
function occurrenceId(seriesId, dueDate) { return `${seriesId}@${dueDate}`; }

/**
 * Marca una tarea como resuelta. Si se repite, crea la siguiente.
 * Devuelve { todo, next } (next = nueva repetición o null).
 */
export async function completeTodo(id, memberId) {
  const rec = await updateTodo(id, { done: true, doneAt: Date.now(), doneBy: memberId || null });
  if (!rec || rec.repeat === 'none') return { todo: rec, next: null };
  const due = nextDue(rec.dueDate, rec.repeat);
  const nextId = occurrenceId(rec.seriesId || rec.id, due);
  const existing = await getOne('todos', nextId);
  if (existing && !existing.deleted) return { todo: rec, next: existing };
  const next = Object.assign({}, rec, {
    id: nextId, dueDate: due, done: false, doneAt: 0, doneBy: null,
    seriesId: rec.seriesId || rec.id, createdAt: Date.now(),
    updatedAt: Date.now(), deleted: false
  });
  await putRaw('todos', next);
  return { todo: rec, next };
}

/** Deshace "resuelta". Quita la repetición que se generó si nadie la ha tocado. */
export async function reopenTodo(id) {
  const rec = await updateTodo(id, { done: false, doneAt: 0, doneBy: null });
  if (!rec || rec.repeat === 'none') return rec;
  const nextId = occurrenceId(rec.seriesId || rec.id, nextDue(rec.dueDate, rec.repeat));
  const next = await getOne('todos', nextId);
  if (next && !next.deleted && !next.done) await deleteTodo(nextId);
  return rec;
}

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
  // el usuario las reintroduce (o usa la invitación del grupo).
  const safeSettings = Object.assign({}, settings, { syncUrl: '', syncSecret: '', ntfyTopic: '' });
  return { app: 'tareas-hogar', version: 2, exportedAt: Date.now(), stores: data, settings: safeSettings };
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
