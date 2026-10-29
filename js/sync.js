/* Sincronización con Google Sheets a través de un Web App de Google Apps Script.
 *
 * Cada grupo tiene su propia hoja (su syncUrl). El campo `groupId` es local:
 * no se sube, y al descargar se asigna el del grupo que se está sincronizando.
 *
 * Estrategia: "last-write-wins" por registro usando el campo updatedAt.
 * - pull: descarga todos los registros remotos y aplica los más nuevos en local.
 * - push: envía los registros locales; el servidor guarda el más nuevo por id.
 *
 * Nota CORS: usamos GET con parámetros y POST con Content-Type "text/plain"
 * para que sean "peticiones simples" y evitar el preflight OPTIONS, que los
 * Web App de Apps Script no gestionan bien.
 */
import { DATA_STORES, getAllRaw, getOne, putRaw, updateGroup } from './db.js';

// Campos que no van dentro del payload data del sheet: las "columnas" y el
// groupId (local).
const META_FIELDS = ['id', 'updatedAt', 'deleted', 'groupId'];

function recordToRow(store, rec) {
  const data = {};
  for (const k of Object.keys(rec)) {
    if (!META_FIELDS.includes(k)) data[k] = rec[k];
  }
  return { store, id: rec.id, updatedAt: rec.updatedAt || 0, deleted: !!rec.deleted, data };
}
function rowToRecord(row, groupId) {
  const rec = Object.assign({}, row.data || {}, { id: row.id, updatedAt: Number(row.updatedAt) || 0, deleted: !!row.deleted });
  rec.groupId = groupId;
  return rec;
}

async function collectLocalRecords(groupId) {
  const out = [];
  for (const store of DATA_STORES) {
    const all = await getAllRaw(store);
    for (const rec of all) if (rec.groupId === groupId) out.push(recordToRow(store, rec));
  }
  return out;
}

function buildUrl(base, params) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** Problema típico de la URL del Web App, o '' si parece correcta. */
export function checkSyncUrl(url) {
  let u;
  try { u = new URL(url); } catch { return 'La URL no es válida'; }
  if (u.hostname !== 'script.google.com') return 'La URL debe ser de script.google.com (la del Web App, no la de la hoja)';
  if (/\/dev$/.test(u.pathname)) return 'Esa es la URL de pruebas (/dev): usa la que termina en /exec';
  if (!/\/exec$/.test(u.pathname)) return 'La URL debe terminar en /exec (Implementar → Gestionar implementaciones)';
  return '';
}

// "Failed to fetch" no dice nada: casi siempre es que Google responde con su
// página de inicio de sesión (sin CORS) porque el Web App no es público.
async function call(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (err) {
    if (!navigator.onLine) throw new Error('Sin conexión a internet');
    throw new Error('Google no permite el acceso. En Apps Script ejecuta doGet una vez y autorízalo, y revisa que la implementación tenga «Quién tiene acceso: Cualquier usuario»');
  }
}

async function remotePull(url, token) {
  const res = await call(buildUrl(url, { action: 'pull', token: token || '' }), {
    method: 'GET',
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json().catch(() => { throw new Error('La respuesta no es del script de Tareas (¿has pegado Code.gs y creado una implementación nueva?)'); });
  if (!json.ok) throw new Error(json.error || 'Error del servidor');
  return json.records || [];
}

async function remotePush(url, token, records) {
  const res = await call(url, {
    method: 'POST',
    // text/plain => petición simple, sin preflight
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'push', token: token || '', records }),
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json().catch(() => { throw new Error('La respuesta no es del script de Tareas (¿has pegado Code.gs y creado una implementación nueva?)'); });
  if (!json.ok) throw new Error(json.error || 'Error del servidor');
  return json;
}

/** Aplica registros remotos en local si son más nuevos. Devuelve nº aplicados. */
async function applyRemote(remoteRows, groupId) {
  let applied = 0;
  for (const row of remoteRows) {
    if (!DATA_STORES.includes(row.store)) continue;
    const incoming = rowToRecord(row, groupId);
    const existing = await getOne(row.store, incoming.id);
    // Nunca pisar un registro de otro grupo (dos grupos con la misma hoja).
    if (existing && existing.groupId && existing.groupId !== groupId) continue;
    if (!existing || (incoming.updatedAt || 0) > (existing.updatedAt || 0)) {
      await putRaw(row.store, incoming);
      applied++;
    }
  }
  return applied;
}

/** Sincronización bidireccional completa de un grupo. */
export async function syncNow(group) {
  if (!group || !group.syncUrl) throw new Error('No hay URL de sincronización configurada');
  const bad = checkSyncUrl(group.syncUrl);
  if (bad) throw new Error(bad);

  // 1) Descargar y fusionar lo remoto.
  const remote = await remotePull(group.syncUrl, group.syncSecret);
  const applied = await applyRemote(remote, group.id);

  // 2) Subir el estado local del grupo (el servidor conserva el más nuevo por id).
  const local = await collectLocalRecords(group.id);
  const pushRes = await remotePush(group.syncUrl, group.syncSecret, local);

  // 3) Si el push devolvió el estado consolidado, volvemos a aplicarlo.
  let appliedBack = 0;
  if (pushRes.records && pushRes.records.length) appliedBack = await applyRemote(pushRes.records, group.id);

  await updateGroup(group.id, { lastSyncAt: Date.now() });
  return { pulled: applied + appliedBack, pushed: local.length };
}

/** Prueba de conexión (solo lectura). */
export async function testConnection(url, token) {
  const bad = checkSyncUrl(url);
  if (bad) throw new Error(bad);
  const records = await remotePull(url, token);
  return { ok: true, count: records.length };
}
