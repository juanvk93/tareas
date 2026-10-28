/* Notificaciones a los móviles del hogar mediante ntfy (https://ntfy.sh).
 *
 * Cada miembro instala la app ntfy y se suscribe al mismo "tema" (topic).
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
import { getOne, putRaw, getSettings } from './db.js';

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

/** URL pública del tema (para abrirlo o suscribirse desde el navegador/app). */
export function topicUrl(server, topic) {
  return `${serverBase(server)}/${encodeURIComponent(topic)}`;
}

function isConfigured(s) {
  return s.notifyEnabled && isValidTopic(s.ntfyTopic);
}

async function publish(server, msg) {
  const res = await fetch(serverBase(server) + '/', {
    method: 'POST',
    body: JSON.stringify(msg)
  });
  if (!res.ok) throw new Error('ntfy HTTP ' + res.status);
}

async function readQueue() {
  const rec = await getOne('meta', QUEUE_KEY);
  return rec ? rec.value : [];
}
async function writeQueue(items) {
  await putRaw('meta', { key: QUEUE_KEY, value: items.slice(-MAX_QUEUE) });
}

/**
 * Envía un aviso a todo el hogar. Nunca lanza: si falla, lo encola.
 * @param {{title?:string, message:string, tags?:string[], priority?:number}} n
 */
export async function notify(n) {
  const s = await getSettings();
  if (!isConfigured(s)) return { sent: false, reason: 'off' };
  const msg = {
    topic: s.ntfyTopic,
    title: n.title || s.groupName || 'Tareas Hogar',
    message: n.message,
    tags: n.tags || [],
    priority: n.priority || 3,
    click: appUrl(),
    createdAt: Date.now()
  };
  try {
    if (!navigator.onLine) throw new Error('offline');
    await publish(s.ntfyServer, stripLocal(msg));
    return { sent: true };
  } catch (err) {
    const q = await readQueue();
    q.push(msg);
    await writeQueue(q);
    return { sent: false, reason: 'queued' };
  }
}

/** Reintenta los avisos pendientes. Devuelve cuántos se enviaron. */
export async function flushQueue() {
  const s = await getSettings();
  if (!isConfigured(s) || !navigator.onLine) return 0;
  const q = await readQueue();
  if (!q.length) return 0;
  const now = Date.now();
  const rest = [];
  let sent = 0;
  for (const msg of q) {
    if (now - (msg.createdAt || 0) > MAX_AGE_MS) continue;
    try { await publish(s.ntfyServer, stripLocal(msg)); sent++; }
    catch { rest.push(msg); }
  }
  await writeQueue(rest);
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
  const { createdAt, ...rest } = msg;
  return rest;
}

/** URL de la app (sin hash) para que al tocar el aviso se abra la PWA. */
function appUrl() {
  return location.origin + location.pathname;
}
