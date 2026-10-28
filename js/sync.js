/* Sincronización con Google Sheets a través de un Web App de Google Apps Script.
 *
 * Estrategia: "last-write-wins" por registro usando el campo updatedAt.
 * - pull: descarga todos los registros remotos y aplica los más nuevos en local.
 * - push: envía los registros locales; el servidor guarda el más nuevo por id.
 *
 * Nota CORS: usamos GET con parámetros y POST con Content-Type "text/plain"
 * para que sean "peticiones simples" y evitar el preflight OPTIONS, que los
 * Web App de Apps Script no gestionan bien.
 */
import {
  DATA_STORES, getAllRaw, getOne, putRaw, getSettings, saveSettings
} from './db.js';

// Campos que son "columnas" (no van dentro del payload data del sheet).
const META_FIELDS = ['id', 'updatedAt', 'deleted'];

function recordToRow(store, rec) {
  const data = {};
  for (const k of Object.keys(rec)) {
    if (!META_FIELDS.includes(k)) data[k] = rec[k];
  }
  return { store, id: rec.id, updatedAt: rec.updatedAt || 0, deleted: !!rec.deleted, data };
}
function rowToRecord(row) {
  return Object.assign({ id: row.id, updatedAt: Number(row.updatedAt) || 0, deleted: !!row.deleted }, row.data || {});
}

async function collectLocalRecords() {
  const out = [];
  for (const store of DATA_STORES) {
    const all = await getAllRaw(store);
    for (const rec of all) out.push(recordToRow(store, rec));
  }
  return out;
}

function buildUrl(base, params) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

async function remotePull(url, token) {
  const res = await fetch(buildUrl(url, { action: 'pull', token: token || '' }), {
    method: 'GET',
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error del servidor');
  return json.records || [];
}

async function remotePush(url, token, records) {
  const res = await fetch(url, {
    method: 'POST',
    // text/plain => petición simple, sin preflight
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'push', token: token || '', records }),
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error del servidor');
  return json;
}

/** Aplica registros remotos en local si son más nuevos. Devuelve nº aplicados. */
async function applyRemote(remoteRows) {
  let applied = 0;
  for (const row of remoteRows) {
    if (!DATA_STORES.includes(row.store)) continue;
    const incoming = rowToRecord(row);
    const existing = await getOne(row.store, incoming.id);
    if (!existing || (incoming.updatedAt || 0) > (existing.updatedAt || 0)) {
      await putRaw(row.store, incoming);
      applied++;
    }
  }
  return applied;
}

/** Sincronización bidireccional completa. */
export async function syncNow() {
  const s = await getSettings();
  if (!s.syncUrl) throw new Error('No hay URL de sincronización configurada');

  // 1) Descargar y fusionar lo remoto.
  const remote = await remotePull(s.syncUrl, s.syncSecret);
  const applied = await applyRemote(remote);

  // 2) Subir el estado local (el servidor conserva el más nuevo por id).
  const local = await collectLocalRecords();
  const pushRes = await remotePush(s.syncUrl, s.syncSecret, local);

  // 3) Si el push devolvió el estado consolidado, volvemos a aplicarlo.
  let appliedBack = 0;
  if (pushRes.records && pushRes.records.length) appliedBack = await applyRemote(pushRes.records);

  await saveSettings({ lastSyncAt: Date.now() });
  return { pulled: applied + appliedBack, pushed: local.length };
}

/** Prueba de conexión (solo lectura). */
export async function testConnection(url, token) {
  const records = await remotePull(url, token);
  return { ok: true, count: records.length };
}
