/* Notificaciones a los móviles del hogar mediante ntfy (https://ntfy.sh).
 *
 * Cada miembro tiene su propio "tema" (member.ntfyTopic, sincronizado) y se
 * suscribe a él en la app ntfy. Al añadir o resolver una tarea se publica en
 * el tema de los DEMÁS, así nadie recibe avisos de lo que hace él mismo.
 * La PWA publica directamente desde el navegador al servidor ntfy, así que
 * no hace falta ningún backend propio.
 *
 * Nota CORS: publicamos en JSON contra la raíz del servidor (POST /) sin
 * cabeceras personalizadas. Así es una "petición simple" (sin preflight) y
 * los textos con acentos van en el cuerpo, no en cabeceras HTTP.
 *
 * Si no hay conexión, el aviso se guarda en una cola (meta.ntfyQueue) y se
 * envía en cuanto vuelva la red (flushQueue).
 */
import { getOne, putRaw } from './db.js';
import { logEvent, maskSecret } from './diag.js';

const QUEUE_KEY = 'ntfyQueue';
const MAX_QUEUE = 50;
const MAX_AGE_MS = 24 * 3600 * 1000; // Un aviso de hace más de un día ya no aporta.

/** Los nombres de tema en ntfy solo admiten letras, números, "-" y "_" (máx. 64). */
export function isValidTopic(topic) {
  return /^[-_A-Za-z0-9]{1,64}$/.test(topic || '');
}

/** Genera un tema difícil de adivinar a partir del nombre del grupo
 * (en ntfy.sh quien conoce el tema puede leer los avisos). */
export function randomTopic(groupName = 'Tareas Hogar') {
  const slug = groupName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tareas';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
  return `${slug}-${suffix}`;
}

function serverBase(server) {
  return (server || 'https://ntfy.sh').trim().replace(/\/+$/, '');
}

/** Enlace que abre la app ntfy de Android y se suscribe al tema (ntfy://host/tema). */
export function subscribeLink(server, topic, display = '') {
  const u = new URL(serverBase(server));
  const params = new URLSearchParams();
  if (display) params.set('display', display);
  if (u.protocol === 'http:') params.set('secure', 'false');
  const q = params.toString();
  return `ntfy://${u.host}${u.pathname.replace(/\/+$/, '')}/${encodeURIComponent(topic)}${q ? '?' + q : ''}`;
}

/** URL pública del tema (para abrirlo o suscribirse desde el navegador/app). */
export function topicUrl(server, topic) {
  return `${serverBase(server)}/${encodeURIComponent(topic)}`;
}


async function publish(server, msg) {
  const base = serverBase(server);
  let res;
  try {
    res = await fetch(base + '/', { method: 'POST', body: JSON.stringify(msg) });
  } catch {
    throw new Error(navigator.onLine ? `No se pudo conectar con ${base}` : 'Sin conexión a internet');
  }
  if (!res.ok) {
    // ntfy explica el motivo en JSON: {"http":429,"error":"limit reached"…}
    const body = await res.text().catch(() => '');
    let why = '';
    try { why = JSON.parse(body).error || ''; } catch { why = body.slice(0, 120); }
    throw new Error(`ntfy respondió HTTP ${res.status}${why ? ': ' + why : ''}`);
  }
}

/** Avisos pendientes de envío (para el diagnóstico). */
export async function queueSize() {
  return (await readQueue()).length;
}

async function readQueue() {
  const rec = await getOne('meta', QUEUE_KEY);
  return rec ? rec.value : [];
}
async function writeQueue(items) {
  await putRaw('meta', { key: QUEUE_KEY, value: items.slice(-MAX_QUEUE) });
}

/** Miembros que reciben avisos (con tema válido), salvo `exceptId` (quien hace el cambio). */
export function recipientsOf(group, members, exceptId) {
  return members.filter((m) => m.id !== exceptId && m.notify && isValidTopic(m.ntfyTopic))
    .map((m) => ({ id: m.id, name: m.name, topic: m.ntfyTopic, server: m.ntfyServer || group.ntfyServer }));
}

/** Separa a quien se le asigna la tarea (recibe «te ha asignado») del resto. */
export function splitAssignee(recipients, assigneeId) {
  const assignee = assigneeId ? recipients.find((r) => r.id === assigneeId) || null : null;
  return { assignee, rest: assignee ? recipients.filter((r) => r !== assignee) : recipients };
}

/**
 * Envía un aviso a cada destinatario (su propio tema). Nunca lanza: lo que
 * falla se encola. Devuelve cuántos se enviaron y cuántos quedaron en cola.
 * @param {object} group  configuración del grupo (para el título y el registro)
 * @param {{name:string, topic:string, server:string}[]} recipients  ver recipientsOf
 * @param {{title?:string, message:string, tags?:string[], priority?:number}} n
 */
export async function notify(group, recipients, n) {
  let sent = 0, queued = 0;
  for (const r of recipients) {
    const msg = {
      server: r.server, topic: r.topic,
      title: n.title || group.name || 'Tareas Hogar',
      message: n.message, tags: n.tags || [], priority: n.priority || 3,
      click: appUrl(), createdAt: Date.now()
    };
    try {
      if (!navigator.onLine) throw new Error('offline');
      await publish(msg.server, stripLocal(msg));
      sent++;
    } catch (err) {
      const q = await readQueue();
      q.push(msg);
      await writeQueue(q);
      queued++;
      logEvent({
        kind: 'ntfy', level: navigator.onLine ? 'error' : 'info', group: group.name,
        message: `Aviso para ${r.name} en cola, se reintentará: ` + (err.message === 'offline' ? 'sin conexión' : err.message),
        detail: { servidor: serverBase(msg.server), tema: maskSecret(msg.topic) }
      });
    }
  }
  return { sent, queued };
}

/** Reintenta los avisos pendientes (de cualquier grupo). Devuelve cuántos se enviaron. */
export async function flushQueue() {
  if (!navigator.onLine) return 0;
  const q = await readQueue();
  if (!q.length) return 0;
  const now = Date.now();
  const rest = [];
  let sent = 0, lastError = null, expired = 0;
  for (const msg of q) {
    if (now - (msg.createdAt || 0) > MAX_AGE_MS) { expired++; continue; }
    try { await publish(msg.server, stripLocal(msg)); sent++; }
    catch (err) { rest.push(msg); lastError = err; }
  }
  await writeQueue(rest);
  if (lastError) logEvent({ kind: 'ntfy', message: `No se pudieron reenviar ${rest.length} avisos en cola: ${lastError.message}` });
  if (expired) logEvent({ kind: 'ntfy', level: 'info', message: `${expired} avisos de hace más de un día descartados sin enviar` });
  return sent;
}

/** Envío de prueba con la configuración indicada (sin cola: queremos ver el error). */
export async function testNotify(server, topic, title = 'Tareas Hogar') {
  if (!isValidTopic(topic)) throw new Error('Tema no válido');
  await publish(server, {
    topic,
    title,
    message: 'Notificación de prueba: ¡todo listo!',
    tags: ['house'],
    click: appUrl()
  });
}

function stripLocal(msg) {
  const { createdAt, server, ...rest } = msg;
  return rest;
}

/** URL de la app (sin hash) para que al tocar el aviso se abra la PWA. */
export function appUrl() {
  return location.origin + location.pathname;
}
