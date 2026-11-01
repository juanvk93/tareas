/* Sincronización con Google Sheets a través de un Web App de Google Apps Script.
 *
 * Protocolo v2 (Code.gs versión 2): una sola petición POST action=sync con lo
 * cambiado en local desde el último envío (group.pushedAt) y el último número de
 * cambio recibido (group.syncRev); el script devuelve solo lo cambiado desde
 * entonces. Si responde full (primera vez, o se archivó algo que este móvil no
 * vio), la lista es completa y se quita en local lo que ya no está.
 * Si el script es de la versión 1 (responde "accion desconocida"), se usa el
 * protocolo antiguo pull + push, que sube y baja todo.
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
import { DATA_STORES, getAllRaw, getOne, putRaw, deleteRaw, updateGroup } from './db.js';
import { maskUrl } from './diag.js';

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

/** Versión del script de Google que necesita esta app (ver SCRIPT_VERSION en Code.gs). */
export const REQUIRED_SCRIPT_VERSION = 2;

/** Registros locales del grupo cambiados después de `since` (0 = todos). */
async function collectLocalRecords(groupId, since = 0) {
  const out = [];
  for (const store of DATA_STORES) {
    const all = await getAllRaw(store);
    for (const rec of all) if (rec.groupId === groupId && (rec.updatedAt || 0) > since) out.push(recordToRow(store, rec));
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
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return ''; // Simulador para pruebas.
  if (u.hostname !== 'script.google.com') return 'La URL debe ser de script.google.com (la del Web App, no la de la hoja)';
  if (/\/dev$/.test(u.pathname)) return 'Esa es la URL de pruebas (/dev): usa la que termina en /exec';
  if (!/\/exec$/.test(u.pathname)) return 'La URL debe terminar en /exec (Implementar → Gestionar implementaciones)';
  return '';
}

/** Error de sincronización con el detalle para el diagnóstico (sin la clave). */
export class SyncError extends Error {
  constructor(message, detail) {
    super(message);
    this.detail = detail;
  }
}

/**
 * Hace la petición y devuelve el JSON del script. step = 'pull' | 'push'.
 * "Failed to fetch" no dice nada: casi siempre es que Google responde con su
 * página de inicio de sesión o de acceso denegado (sin CORS), y el navegador
 * no deja ver esa respuesta. Lo traducimos a algo que se pueda arreglar.
 */
async function call(step, url, opts) {
  const t0 = Date.now();
  const detail = { paso: step, url: maskUrl(url), conexion: navigator.onLine ? 'sí' : 'no' };
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    detail.ms = Date.now() - t0;
    detail.error = err.message;
    if (!navigator.onLine) throw new SyncError('Sin conexión a internet', detail);
    detail.cors = 'sí (el navegador no deja leer la respuesta: suele ser un 403 o la página de inicio de sesión de Google)';
    throw new SyncError('Google no permite el acceso. En Apps Script ejecuta doGet una vez y autorízalo, y revisa que la implementación tenga «Quién tiene acceso: Cualquier usuario»', detail);
  }
  detail.ms = Date.now() - t0;
  detail.http = res.status;
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    detail.respuesta = snippet(text);
    throw new SyncError('Google respondió HTTP ' + res.status, detail);
  }
  let json;
  try { json = JSON.parse(text); } catch {
    detail.respuesta = snippet(text);
    throw new SyncError('La respuesta no es del script de Tareas (¿has pegado Code.gs y creado una implementación nueva?)', detail);
  }
  if (!json.ok) {
    detail.respuesta = snippet(text);
    throw new SyncError(json.error === 'unauthorized' ? 'Clave secreta incorrecta: debe coincidir con SECRET del script' : (json.error || 'Error del servidor'), detail);
  }
  return json;
}
/** Texto legible de una respuesta (sin etiquetas HTML), recortado. */
function snippet(text) {
  return String(text).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

async function remotePull(url, token) {
  return call('pull', buildUrl(url, { action: 'pull', token: token || '' }), {
    method: 'GET',
    redirect: 'follow'
  });
}

async function remoteSync(url, token, since, records) {
  return call('sync', url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'sync', token: token || '', since, records }),
    redirect: 'follow'
  });
}

async function remotePush(url, token, records) {
  return call('push', url, {
    method: 'POST',
    // text/plain => petición simple, sin preflight
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'push', token: token || '', records }),
    redirect: 'follow'
  });
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

/** Con una lista completa del servidor: quita en local lo que ya no está (se
 * archivó o se limpió), salvo lo que se acaba de enviar o lo que ha cambiado
 * mientras tanto (se enviará la próxima vez). Devuelve cuántos. */
async function reconcile(groupId, remoteRows, sentRows, startedAt) {
  const keep = new Set([...remoteRows, ...sentRows].map((r) => `${r.store}::${r.id}`));
  let removed = 0;
  for (const store of DATA_STORES) {
    for (const rec of await getAllRaw(store)) {
      if (rec.groupId !== groupId || keep.has(`${store}::${rec.id}`) || (rec.updatedAt || 0) > startedAt) continue;
      await deleteRaw(store, rec.id);
      removed++;
    }
  }
  return removed;
}

/** Sincronización bidireccional de un grupo (v2 incremental o v1 completa). */
export async function syncNow(group) {
  if (!group || !group.syncUrl) throw new Error('No hay URL de sincronización configurada');
  const bad = checkSyncUrl(group.syncUrl);
  if (bad) throw new Error(bad);

  const since = group.syncRev || 0;
  // Sin syncRev (primera vez o hoja nueva) se envía todo, pase lo que pase con pushedAt.
  const pushedAt = since ? (group.pushedAt || 0) : 0;
  const startedAt = Date.now();
  const changed = await collectLocalRecords(group.id, pushedAt);
  let res;
  try {
    res = await remoteSync(group.syncUrl, group.syncSecret, since, changed);
  } catch (err) {
    if (err.message !== 'accion desconocida') throw err;
    return legacySync(group); // Script de la versión 1.
  }
  const pulled = await applyRemote(res.records || [], group.id);
  const removed = res.full ? await reconcile(group.id, res.records || [], changed, startedAt) : 0;
  await updateGroup(group.id, {
    lastSyncAt: Date.now(), syncRev: Number(res.rev) || 0, pushedAt: startedAt,
    scriptVersion: Number(res.version) || 1, summaryInstalled: !!res.summary
  });
  return { pulled: pulled + removed, pushed: changed.length, full: !!res.full };
}

/** Protocolo de la versión 1: bajar todo, subir todo. */
async function legacySync(group) {
  const remote = await remotePull(group.syncUrl, group.syncSecret);
  const applied = await applyRemote(remote.records || [], group.id);
  const local = await collectLocalRecords(group.id);
  const pushRes = await remotePush(group.syncUrl, group.syncSecret, local);
  let appliedBack = 0;
  if (pushRes.records && pushRes.records.length) appliedBack = await applyRemote(pushRes.records, group.id);
  await updateGroup(group.id, { lastSyncAt: Date.now(), scriptVersion: 1, syncRev: 0, pushedAt: 0, summaryInstalled: false });
  return { pulled: applied + appliedBack, pushed: local.length, full: true };
}

/** Prueba de conexión (solo lectura). */
export async function testConnection(url, token) {
  const bad = checkSyncUrl(url);
  if (bad) throw new Error(bad);
  const json = await remotePull(url, token);
  return { ok: true, count: (json.records || []).length, version: Number(json.version) || 1 };
}
