/* Capa de datos sobre IndexedDB.
 *
 * Almacenes (object stores) que se sincronizan con su grupo:
 *   - members : miembros del grupo   {id, groupId, name, color, updatedAt, deleted}
 *   - todos   : tareas pendientes    {id, groupId, title, icon, dueDate, repeat, assignee,
 *                                     note, done, doneAt, doneBy, createdBy, createdAt,
 *                                     seriesId, updatedAt, deleted}
 * Y uno local:
 *   - meta    : ajustes/config       {key, value}
 *
 * Grupos: un móvil puede estar en varios (p. ej. uno compartido y otro
 * personal). La lista vive en settings.groups y cada registro lleva el
 * `groupId` LOCAL de su grupo. Ese id no se sincroniza: cada grupo tiene su
 * propia Google Sheet, así que al descargar se asigna el del grupo (ver sync.js).
 *
 * Los borrados son "blandos" (deleted:true + updatedAt) para poder
 * sincronizarlos entre dispositivos (tombstones). La interfaz filtra los
 * registros con deleted:true.
 */
import { nextDue } from './dates.js';

const DB_NAME = 'tareas-hogar';
const DB_VERSION = 2;
export const DATA_STORES = ['members', 'todos'];

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
export async function deleteRaw(store, id) {
  await openDB();
  return reqToPromise(tx(store, 'readwrite').delete(id));
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
  myName: '',          // Tu nombre, para proponerlo al crear o unirte a grupos.
  groups: [],
  activeGroupId: null
};

/* Configuración de cada grupo (elemento de settings.groups). */
const GROUP_DEFAULTS = {
  name: '',
  personal: false,       // Personal = solo tú (sin miembros ni invitación).
  currentMemberId: null, // Tu persona dentro de este grupo.
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

/* -------------------------------- Grupos --------------------------------- */
export function activeGroup(settings) {
  return settings.groups.find((g) => g.id === settings.activeGroupId) || settings.groups[0] || null;
}
export async function getGroup(id) {
  return (await getSettings()).groups.find((g) => g.id === id) || null;
}
export async function addGroup(fields, { activate = true } = {}) {
  const s = await getSettings();
  const group = Object.assign({}, GROUP_DEFAULTS, fields, { id: uid(), createdAt: Date.now() });
  await saveSettings({ groups: [...s.groups, group], activeGroupId: activate ? group.id : (s.activeGroupId || group.id) });
  return group;
}
export async function updateGroup(id, patch) {
  const s = await getSettings();
  return saveSettings({ groups: s.groups.map((g) => (g.id === id ? Object.assign({}, g, patch) : g)) });
}
/** Quita el grupo de este móvil y borra (de verdad) sus registros locales. */
export async function removeGroup(id) {
  for (const store of DATA_STORES) {
    for (const rec of await getAllRaw(store)) if (rec.groupId === id) await deleteRaw(store, rec.id);
  }
  const s = await getSettings();
  const groups = s.groups.filter((g) => g.id !== id);
  return saveSettings({ groups, activeGroupId: s.activeGroupId === id ? (groups[0] ? groups[0].id : null) : s.activeGroupId });
}

/* --------------------------- Utilidades varias --------------------------- */
export function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/* --------------------------- Miembros del grupo -------------------------- */
export async function addMember({ groupId, name, color }) {
  const rec = { id: uid(), groupId, name: name.trim(), color, updatedAt: Date.now(), deleted: false };
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
export async function members(groupId) {
  return (await getActive('members')).filter((r) => r.groupId === groupId);
}

/* ---------------------------- Tareas pendientes -------------------------- */
export async function addTodo({ groupId, title, icon, dueDate, repeat, assignee, note, createdBy }) {
  const id = uid();
  const rec = {
    id, groupId, title: title.trim(), icon: icon || 'sparkles', dueDate,
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
export async function todos(groupId) {
  return (await getActive('todos')).filter((r) => r.groupId === groupId);
}

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
  // No exportamos claves de sincronización ni temas de ntfy por seguridad;
  // se recuperan con la invitación de cada grupo.
  const groups = settings.groups.map((g) => Object.assign({}, g, { syncUrl: '', syncSecret: '', ntfyTopic: '' }));
  return { app: 'tareas-hogar', version: 3, exportedAt: Date.now(), stores: data, settings: Object.assign({}, settings, { groups }) };
}
/** Importa una copia. Los registros de grupos que no existen en este móvil
 * (o de copias sin grupos) van al grupo `fallbackGroupId`. */
export async function importAll(payload, { merge = true, fallbackGroupId } = {}) {
  if (!payload || !payload.stores) throw new Error('Archivo no válido');
  const known = new Set((await getSettings()).groups.map((g) => g.id));
  for (const s of DATA_STORES) {
    const incoming = payload.stores[s] || [];
    if (!merge) await clearStore(s);
    for (const raw of incoming) {
      const rec = known.has(raw.groupId) ? raw : Object.assign({}, raw, { groupId: fallbackGroupId });
      if (merge) {
        const existing = await getOne(s, rec.id);
        if (existing && (existing.updatedAt || 0) >= (rec.updatedAt || 0)) continue;
      }
      await putRaw(s, rec);
    }
  }
}
