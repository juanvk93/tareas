/* Registro de diagnóstico: últimos errores de sincronización, avisos (ntfy),
 * JavaScript y Service Worker, guardado en IndexedDB (meta.diagLog).
 *
 * En el móvil no hay consola: esto permite ver qué respondió Google o ntfy
 * (Ajustes → Diagnóstico) y copiar un informe sin URLs completas ni claves.
 */
import { getOne, putRaw } from './db.js';

const KEY = 'diagLog';
const MAX = 100;

/** Sincronización, avisos, JavaScript o Service Worker. */
export const KINDS = { sync: 'Sincronización', ntfy: 'Avisos', js: 'JavaScript', sw: 'Service Worker' };

async function read() {
  try { return (await getOne('meta', KEY))?.value || []; } catch { return []; }
}

// Las escrituras se encadenan: dos eventos a la vez no se pisan.
let chain = Promise.resolve();

/**
 * Añade un evento. Nunca lanza. Si coincide con el último (mismo tipo, grupo y
 * mensaje) solo suma una repetición: un fallo cada minuto no llena el registro.
 * @param {{kind:string, level?:'error'|'info', group?:string, message:string, detail?:object}} e
 */
export function logEvent({ kind, level = 'error', group = '', message, detail = null }) {
  chain = chain.then(async () => {
    const log = await read();
    const last = log[log.length - 1];
    const at = Date.now();
    if (last && last.kind === kind && last.level === level && last.group === group && last.message === message) {
      Object.assign(last, { at, detail, count: (last.count || 1) + 1 });
    } else {
      log.push({ at, kind, level, group, message: String(message || ''), detail, count: 1 });
    }
    await putRaw('meta', { key: KEY, value: log.slice(-MAX) });
  }).catch(() => {});
  return chain;
}

/** Eventos, el más reciente primero. */
export async function readLog() {
  await chain;
  return (await read()).slice().reverse();
}

export async function clearLog() {
  await chain;
  await putRaw('meta', { key: KEY, value: [] });
}

/** URL sin querystring (lleva la clave) y con el id del script recortado. */
export function maskUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/s\/([-\w]{12,})\//, (_, id) => `/s/${id.slice(0, 6)}…${id.slice(-4)}/`);
    return `${u.origin}${path}`;
  } catch { return '(URL no válida)'; }
}

/** Oculta la mayor parte de un secreto (tema de ntfy, clave). */
export function maskSecret(s) {
  if (!s) return '';
  return s.length <= 6 ? '•'.repeat(s.length) : `${s.slice(0, 4)}…${s.slice(-2)}`;
}

/** Errores de JavaScript no capturados → registro. */
export function installGlobalHandlers() {
  window.addEventListener('error', (e) => {
    if (!e.message) return; // Fallos de carga de recursos: los cuenta el Service Worker.
    logEvent({
      kind: 'js', message: e.message,
      detail: { origen: `${(e.filename || '').split('/').slice(-2).join('/')}:${e.lineno}:${e.colno}`, pila: stackOf(e.error) }
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    logEvent({ kind: 'js', message: 'Promesa rechazada: ' + (r && r.message ? r.message : String(r)), detail: r && r.stack ? { pila: stackOf(r) } : null });
  });
}
function stackOf(err) {
  return err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n') : undefined;
}
