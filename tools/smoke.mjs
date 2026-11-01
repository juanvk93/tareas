// Prueba de humo en Chrome headless (sin dependencias): npm run smoke
//
// Levanta un servidor estático (con la caché HTTP de 10 min de GitHub Pages),
// un simulador del Web App de Apps Script y Chrome headless, y recorre la app
// como lo haría una persona: dos "móviles" = dos perfiles aislados de Chrome.
// Nunca envía avisos reales (ntfy.sh está bloqueado) ni toca Google.
//
// Variables: CHROME=/ruta/a/chrome · SMOKE_SHOW=1 para ver la ventana ·
// SMOKE_SHOTS=1 para guardar una captura de cada escenario (para revisar el aspecto).
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../js/changelog.js';
import { DEFAULT_CATALOG } from '../js/catalog.js';
import { createGasSim } from './gas-sim.mjs';

if (!globalThis.WebSocket) {
  console.error('Hace falta WebSocket: usa Node 22+ o «node --experimental-websocket» (npm run smoke ya lo hace).');
  process.exit(2);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = await mkdtemp(join(tmpdir(), 'tareas-smoke-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = JSON.stringify;

/* ----------------------------- Servidores ------------------------------ */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.gs': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};
const listen = (server, port = 0) => new Promise((r) => server.listen(port, '127.0.0.1', () => r(server.address().port)));

// ruta → (texto) => texto: simula publicar otra versión sin tocar los archivos.
const overrides = new Map();
const web = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    let body = await readFile(file);
    if (overrides.has(path)) body = overrides.get(path)(body.toString('utf8'));
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
    res.end(body);
  } catch { res.writeHead(404).end('404'); }
});

// Web App simulado: el Code.gs REAL (tools/gas-sim.mjs) detrás de un servidor HTTP.
// /macros/s/v1/… usa la versión 1 del script (compatibilidad); /macros/s/denegado/…
// responde como Google cuando el script no es público (403 en HTML y sin CORS).
const gasSim = createGasSim();
const gasV1 = createGasSim({ source: 'tools/fixtures/Code.v1.gs' });
const gasLog = []; // {action, sent, got, full}: lo que pide la app y lo que recibe.
const rows = (store) => gasSim.sheetRows().slice(1)
  .filter((r) => r[1] && r[0] === store && !(r[3] === 1 || r[3] === true))
  .map((r) => ({ store: r[0], id: r[1], updatedAt: r[2], data: JSON.parse(r[4] || '{}') }));
const gas = createServer((req, res) => {
  if (req.url.startsWith('/macros/s/denegado/')) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<html><title>Acceso denegado</title><body>Necesitas acceso</body></html>');
  }
  const sim = req.url.startsWith('/macros/s/v1/') ? gasV1 : gasSim;
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const out = req.method === 'POST' ? sim.request('POST', {}, JSON.parse(body || '{}')) : sim.request('GET', Object.fromEntries(u.searchParams));
    const sent = req.method === 'POST' ? (JSON.parse(body || '{}').records || []).length : 0;
    if (sim === gasSim) gasLog.push({ action: req.method === 'POST' ? JSON.parse(body || '{}').action : u.searchParams.get('action'), sent, got: (out.records || []).length, full: out.full });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(out));
  });
});

// Simulador de ntfy: guarda lo que se publica (POST / con JSON) para comprobar a quién va.
const published = [];
const ntfy = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method === 'POST') { try { published.push(JSON.parse(body)); } catch { /* no JSON */ } }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end('{}');
  });
});

const webPort = await listen(web);
const ntfyPort = await listen(ntfy);
const NTFY = `http://127.0.0.1:${ntfyPort}`;
const gasPort = await listen(gas);
const BASE = `http://127.0.0.1:${webPort}/`;
const GAS = `http://127.0.0.1:${gasPort}/macros/s/prueba/exec`;

/* ------------------------------- Chrome -------------------------------- */
const chromeBin = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find((p) => p && existsSync(p));
if (!chromeBin) { console.error('No encuentro Chrome. Indica la ruta con CHROME=/ruta/a/chrome'); process.exit(2); }

const profile = await mkdtemp(join(tmpdir(), 'tareas-chrome-'));
const chrome = spawn(chromeBin, [
  ...(process.env.SMOKE_SHOW ? [] : ['--headless=new']),
  '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'
], { stdio: 'ignore' });

let wsUrl = '';
for (let i = 0; i < 100 && !wsUrl; i++) {
  try {
    const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
    wsUrl = `ws://127.0.0.1:${port}${path}`;
  } catch { await sleep(100); }
}
if (!wsUrl) { console.error('Chrome no ha arrancado'); await cleanup(); process.exit(2); }

/* ---------------------------- Cliente CDP ------------------------------ */
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
      } else this.handlers.get(m.sessionId || '')?.(m.method, m.params);
    };
  }
  open() { return new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; }); }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(sessionId, fn) { this.handlers.set(sessionId, fn); }
}

const cdp = new CDP(wsUrl);
await cdp.open();
const pages = [];

/** Un "móvil": pestaña en un contexto aislado (su propio IndexedDB y Service Worker). */
async function openPhone(name) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const errors = [];
  cdp.on(sessionId, (method, p) => {
    if (method === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
    if (method === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
  });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*ntfy.sh*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 1, mobile: true });

  const page = {
    name, errors, send,
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(expr, what, timeout = 6000) {
      const end = Date.now() + timeout;
      let last;
      while (Date.now() < end) {
        try { if (await page.eval(expr)) return; } catch (e) { last = e; }
        await sleep(100);
      }
      throw new Error(`Tiempo agotado esperando ${what}${last ? ` (${last.message.split('\n')[0]})` : ''}`);
    },
    async goto(url) {
      await send('Page.navigate', { url });
      await page.waitFor('window.__tareasBooted === true', 'el arranque de la app', 10000);
    },
    async reload() {
      await page.eval('window.__tareasBooted = false');
      await send('Page.reload', {});
      await page.waitFor('window.__tareasBooted === true', 'el arranque tras recargar', 10000);
    },
    async shot(file) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(OUT, file), Buffer.from(data, 'base64'));
      return join(OUT, file);
    },
    fill: (sel, value) => page.eval(`(() => {
      const el = document.querySelector(${q(sel)});
      if (!el) throw new Error('No existe ' + ${q(sel)});
      el.value = ${q(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`),
    check: (sel, on) => page.eval(`(() => {
      const el = document.querySelector(${q(sel)});
      if (el) { el.checked = ${!!on}; el.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    })()`),
    click: (sel, text = '') => page.eval(`(() => {
      const els = [...document.querySelectorAll(${q(sel)})];
      const el = ${text ? `els.find((e) => e.textContent.includes(${q(text)}))` : 'els[0]'};
      if (!el) throw new Error('No existe ' + ${q(sel + (text ? ` con «${text}»` : ''))});
      el.click();
      return true;
    })()`),
    /** Expresión: ¿algún elemento del selector contiene el texto? */
    textIn: (sel, text) => `[...document.querySelectorAll(${q(sel)})].some((e) => e.textContent.includes(${q(text)}))`,
    /** Abre el selector de grupos (asíncrono) y cambia al grupo indicado. */
    async switchGroup(name) {
      await page.click('#group-switch');
      await page.waitFor(page.textIn('[data-switch]', name), `el grupo «${name}» en el selector`);
      await page.click('[data-switch]', name);
      await page.waitFor(`document.querySelector('#header-title').textContent === ${q(name)} && !document.querySelector('.modal-overlay')`, `el grupo «${name}» activo`);
    },
    async tab(v) {
      // Se marca el contenido actual: la pestaña está lista cuando se ha repintado (la marca desaparece).
      await page.eval(`[...document.querySelector('#view').children].forEach((e) => e.setAttribute('data-smoke-old', '')), true`);
      await page.click(`[data-view="${v}"]`);
      await page.waitFor(`document.querySelector('.tabbar__item.is-active')?.dataset.view === ${q(v)} && document.querySelector('#view').children.length > 0 && !document.querySelector('#view [data-smoke-old]')`, `la pestaña ${v}`);
      await page.eval('new Promise((r) => requestAnimationFrame(() => r(true)))');
    }
  };
  pages.push(page);
  return page;
}

async function until(fn, what, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (fn()) return; await sleep(100); }
  throw new Error(`Tiempo agotado esperando ${what}`);
}

/* ------------------------------ Escenarios ----------------------------- */
let failed = false;
async function run(name, fn) {
  if (failed) return console.log(`  - ${name} (omitida)`);
  const t0 = Date.now();
  const slug = name.normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase().slice(0, 40);
  try {
    await fn();
    console.log(`  ✔ ${name} (${Date.now() - t0} ms)`);
    if (process.env.SMOKE_SHOTS) for (const p of pages) await p.shot(`${slug}-${p.name}.png`).catch(() => {});
  } catch (e) {
    failed = true;
    const shots = [];
    for (const p of pages) shots.push(await p.shot(`${slug}-${p.name}.png`).catch(() => ''));
    console.log(`  ✖ ${name}\n    ${e.message}\n    Capturas: ${shots.filter(Boolean).join('  ')}`);
  }
}

console.log(`Prueba de humo · Tareas v${APP_VERSION}`);
const A = await openPhone('movil-A');
let B = null; // Segundo móvil: se crea al probar la sincronización.

await run('Arranca y muestra la versión', async () => {
  await A.goto(BASE);
  await A.waitFor(`document.querySelector('#header-version').textContent === ${q('v' + APP_VERSION)}`, 'la versión en la cabecera');
  await A.waitFor(`!!document.querySelector('#ob-create')`, 'la pantalla de bienvenida');
});

await run('Crea un grupo compartido', async () => {
  await A.fill('#ob-group', 'Casa');
  await A.fill('#ob-name', 'Juan');
  await A.check('#ob-notify', false);
  await A.check('#ob-personal-too', false);
  await A.click('#ob-create');
  // Al crear un grupo compartido la app lleva a Grupo (para invitar).
  await A.waitFor(`document.querySelector('#header-title').textContent === 'Casa' && !document.body.classList.contains('no-group') && document.querySelector('.tabbar__item.is-active')?.dataset.view === 'grupo'`, 'el grupo «Casa» en la pestaña Grupo');
  await A.tab('hoy');
  await A.waitFor(`!!document.querySelector('#search-input')`, 'el buscador de Hoy');
});

await run('Añade una tarea desde el buscador y la resuelve', async () => {
  await A.fill('#search-input', 'Regar el cactus');
  await A.eval(`document.querySelector('#search-add').requestSubmit(), true`);
  await A.waitFor(A.textIn('[data-tile-todo]', 'Regar el cactus'), 'la casilla pendiente');
  await A.click('[data-tile-todo]', 'Regar el cactus');
  await A.waitFor(`!(${A.textIn('[data-tile-todo]', 'Regar el cactus')})`, 'que deje de estar pendiente');
  await A.tab('hechas');
  await A.waitFor(A.textIn('#view', 'Regar el cactus'), 'la tarea en Hechas');
});

await run('Deshacer devuelve la tarea a pendientes', async () => {
  await A.tab('hoy');
  await A.fill('#search-input', 'Comprar bombillas');
  await A.eval(`document.querySelector('#search-add').requestSubmit(), true`);
  await A.waitFor(A.textIn('[data-tile-todo]', 'Comprar bombillas'), 'la casilla pendiente');
  await A.eval(`document.querySelectorAll('.toast').forEach((t) => t.remove()), true`); // Solo el Deshacer de esta.
  await A.click('[data-tile-todo]', 'Comprar bombillas');
  await A.waitFor(A.textIn('.toast__action', 'Deshacer'), 'el botón Deshacer');
  await A.click('.toast__action', 'Deshacer');
  await A.waitFor(A.textIn('[data-tile-todo]', 'Comprar bombillas'), 'que vuelva a estar pendiente');
});

await run('Modales del catálogo, novedades y selector de grupos', async () => {
  const closeAll = async () => {
    await A.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true`);
    await A.waitFor(`!document.querySelector('.modal-overlay')`, 'que se cierre el modal');
  };
  // Pulsación larga (clic derecho) en una tarea habitual → su modal.
  await A.eval(`(() => { const el = [...document.querySelectorAll('[data-tile-add]')].find((e) => e.textContent.includes('Barrer')); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); return true; })()`);
  await A.waitFor(`document.querySelector('#it-name')?.value === 'Barrer'`, 'el modal de la tarea habitual');
  await closeAll();
  await A.click('[data-edit-cat]');
  await A.waitFor(`document.querySelector('#cat-name')?.value === 'Limpieza'`, 'el modal de la categoría');
  await closeAll();
  await A.click('#header-version');
  await A.waitFor(A.textIn('.modal', APP_VERSION), 'las novedades con la versión actual');
  await closeAll();
  await A.click('#group-switch');
  await A.waitFor(A.textIn('[data-switch]', 'Casa'), 'el selector con el grupo «Casa»');
  await closeAll();
});

await run('Crea un segundo grupo (privado) y cambia entre grupos', async () => {
  await A.click('#group-switch');
  await A.waitFor(`!!document.querySelector('[data-new="personal"]')`, 'el selector de grupos');
  await A.click('[data-new="personal"]');
  await A.waitFor(`!!document.querySelector('#ob-create')`, 'el formulario de grupo nuevo');
  await A.fill('#ob-group', 'Mis cosas');
  await A.click('#ob-create');
  await A.waitFor(`document.querySelector('#header-title').textContent === 'Mis cosas'`, 'el grupo «Mis cosas» activo');
  await A.switchGroup('Casa');
  await A.waitFor(`document.querySelector('#header-title').textContent === 'Casa'`, 'volver a «Casa»');
});

await run('Planifica una tarea cada 2 semanas y salen sus repeticiones', async () => {
  await A.tab('proximas');
  await A.click('#fab-add');
  await A.waitFor(`!!document.querySelector('#td-title')`, 'el modal de tarea');
  await A.fill('#td-title', 'Sacar el vidrio');
  await A.fill('#td-repeat', '2w');
  await A.click('#td-save');
  await A.waitFor(`!document.querySelector('.modal-overlay')`, 'que se cierre el modal');
  await A.waitFor(`[...document.querySelectorAll('.todo')].filter((e) => e.textContent.includes('Sacar el vidrio')).length >= 2 && !!document.querySelector('.todo.is-projected')`, 'la tarea y sus repeticiones previstas');
});

await run('Repite en días de la semana (lunes y jueves)', async () => {
  await A.tab('proximas');
  await A.click('#fab-add');
  await A.waitFor(`!!document.querySelector('#td-title')`, 'el modal de tarea');
  await A.fill('#td-title', 'Sacar la basura');
  await A.fill('#td-repeat', 'days');
  await A.waitFor(`!document.querySelector('#td-repeat-days').classList.contains('hidden')`, 'el selector de días');
  // Desmarca el día que venga marcado y marca lunes y jueves.
  await A.eval(`document.querySelectorAll('[data-wd].is-active').forEach((b) => b.click()), true`);
  await A.waitFor(A.textIn('#td-repeat-hint', 'Elige al menos un día'), 'el aviso sin días');
  await A.click('[data-wd="1"]');
  await A.click('[data-wd="4"]');
  await A.waitFor(A.textIn('#td-repeat-hint', 'Lunes y jueves · primera vez'), 'el resumen «Lunes y jueves»');
  if (process.env.SMOKE_SHOTS) { await A.eval(`document.querySelector('#td-repeat-days').scrollIntoView({ block: 'center' }), true`); await A.shot('dias-semana-modal.png'); }
  await A.click('#td-save');
  await A.waitFor(`!document.querySelector('.modal-overlay')`, 'que se cierre el modal');
  const days = await A.eval(`(async () => {
    const db = await import('./js/db.js');
    const { isoDay, currentDue } = await import('./js/dates.js');
    const t = (await db.getAllRaw('todos')).find((x) => x.title === 'Sacar la basura');
    return { repeat: t.repeat, day: isoDay(t.dueDate) };
  })()`);
  if (days.repeat !== '1w:1,4' || ![1, 4].includes(days.day)) throw new Error(`guardada como ${days.repeat}, día ${days.day}`);
  await A.waitFor(`[...document.querySelectorAll('.todo')].filter((e) => e.textContent.includes('Sacar la basura')).length >= 3`, 'la tarea y sus repeticiones en Próximas');
  await A.waitFor(A.textIn('.todo', 'Lunes y jueves'), 'la etiqueta «Lunes y jueves»');
});

await run('Repite desde el día en que se hace y Deshacer quita la siguiente', async () => {
  // Interfaz: la opción sale con intervalos y no con días de la semana.
  await A.tab('proximas');
  await A.click('#fab-add');
  await A.waitFor(`!!document.querySelector('#td-title')`, 'el modal de tarea');
  await A.waitFor(`document.querySelector('#td-from-done-row').classList.contains('hidden')`, 'sin la opción si no se repite');
  await A.fill('#td-repeat', '1w');
  await A.waitFor(`!document.querySelector('#td-from-done-row').classList.contains('hidden')`, 'la opción con «Cada semana»');
  if (process.env.SMOKE_SHOTS) { await A.eval(`document.querySelector('#td-from-done-row').scrollIntoView({ block: 'center' }), true`); await A.shot('desde-que-se-hace-modal.png'); }
  await A.fill('#td-repeat', 'days');
  await A.waitFor(`document.querySelector('#td-from-done-row').classList.contains('hidden')`, 'sin la opción con días de la semana');
  await A.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true`);
  await A.waitFor(`!document.querySelector('.modal-overlay')`, 'que se cierre el modal');

  // Datos: «cada 10 días desde que se hace», con 12 días de retraso.
  const today = await A.eval(`import('./js/dates.js').then((d) => d.todayKey())`);
  await A.eval(`(async () => {
    const db = await import('./js/db.js');
    const { G } = await import('./js/state.js');
    const { addDays, todayKey } = await import('./js/dates.js');
    await db.addTodo({ groupId: G().id, title: 'Limpiar filtros', icon: 'droplet', dueDate: addDays(todayKey(), -12), repeat: '10d', repeatFrom: 'done' });
    return true;
  })()`);
  await A.tab('hoy');
  await A.waitFor(A.textIn('[data-tile-todo]', 'Limpiar filtros'), 'la tarea atrasada en Hoy');
  await A.eval(`document.querySelectorAll('.toast').forEach((t) => t.remove()), true`);
  await A.click('[data-tile-todo]', 'Limpiar filtros');
  const expected = await A.eval(`import('./js/dates.js').then((d) => d.addDays(d.todayKey(), 10))`);
  const next = await A.eval(`import('./js/db.js').then(async (db) => (await db.getAllRaw('todos')).filter((t) => t.title === 'Limpiar filtros' && !t.done && !t.deleted).map((t) => t.dueDate))`);
  if (next.length !== 1 || next[0] !== expected) throw new Error(`siguiente ${JSON.stringify(next)}, se esperaba ${expected} (hoy ${today} + 10)`);
  await A.tab('proximas');
  await A.waitFor(A.textIn('.todo', 'Cada 10 días desde la última vez'), 'la etiqueta en Próximas');
  const rows = await A.eval(`[...document.querySelectorAll('.todo')].filter((e) => e.textContent.includes('Limpiar filtros')).length`);
  if (rows !== 1) throw new Error(`Próximas muestra ${rows} filas de «Limpiar filtros» (sin repeticiones previstas debería ser 1)`);
  // Deshacer (desde Hechas) vuelve a dejarla pendiente y borra la siguiente.
  await A.tab('hoy');
  await A.eval(`(async () => {
    const db = await import('./js/db.js');
    const done = (await db.getAllRaw('todos')).find((t) => t.title === 'Limpiar filtros' && t.done);
    await db.reopenTodo(done.id);
    return true;
  })()`);
  const left = await A.eval(`import('./js/db.js').then(async (db) => (await db.getAllRaw('todos')).filter((t) => t.title === 'Limpiar filtros' && !t.deleted).map((t) => (t.done ? 'hecha ' : 'pendiente ') + t.dueDate))`);
  if (left.length !== 1 || !left[0].startsWith('pendiente')) throw new Error(`tras deshacer: ${JSON.stringify(left)}`);
});

await run('Pausa una tarea (sin fecha y con fecha) y el modo vacaciones', async () => {
  const todosOf = (title) => A.eval(`import('./js/db.js').then(async (db) => (await db.getAllRaw('todos')).filter((t) => t.title === ${q(title)} && !t.done && !t.deleted))`);
  const openRow = async (title) => {
    await A.eval(`(() => { const r = [...document.querySelectorAll('.todo:not(.is-projected)')].find((e) => e.textContent.includes(${q(title)})); r.querySelector('[data-open]').click(); return true; })()`);
    await A.waitFor(`!!document.querySelector('#td-title')`, 'el modal de la tarea');
  };
  // Sin fecha: sale de Próximas normal y aparece en «En pausa»; no sale en Hoy.
  await A.tab('proximas');
  await openRow('Sacar la basura');
  if (process.env.SMOKE_SHOTS) { await A.eval(`document.querySelector('#td-pause-open').scrollIntoView({ block: 'center' }), true`); await A.shot('pausa-modal.png'); }
  await A.click('#td-pause-open');
  await A.waitFor(A.textIn('.section-title', 'En pausa') + ' && ' + A.textIn('.todo', 'En pausa'), 'la sección «En pausa»');
  const rowsPaused = await A.eval(`[...document.querySelectorAll('.todo')].filter((e) => e.textContent.includes('Sacar la basura')).length`);
  if (process.env.SMOKE_SHOTS) { await A.eval(`document.querySelectorAll('.toast').forEach((t) => t.remove()); window.scrollTo(0, document.body.scrollHeight); true`); await A.shot('pausa-proximas.png'); }
  if (rowsPaused !== 1) throw new Error(`en pausa debería salir una vez (sin repeticiones previstas) y sale ${rowsPaused}`);
  await A.click('[data-resume]');
  await A.waitFor(`!${A.textIn('.section-title', 'En pausa')}`, 'que se reanude');
  // Con fecha: pasa a su primer lunes o jueves desde esa fecha.
  const until = await A.eval(`import('./js/dates.js').then((d) => d.addDays(d.todayKey(), 14))`);
  await openRow('Sacar la basura');
  await A.fill('#td-pause-until', until);
  await A.click('#td-pause-date');
  await A.waitFor(A.textIn('.todo', 'En pausa hasta'), 'la etiqueta «En pausa hasta»');
  let [t] = await todosOf('Sacar la basura');
  const day = await A.eval(`import('./js/dates.js').then((d) => d.isoDay(${q(t.dueDate)}))`);
  if (t.dueDate < until || ![1, 4].includes(day) || t.pausedUntil !== until) throw new Error(`pausada hasta ${until}: queda ${t.dueDate} (día ${day})`);
  // Reanudar ya: vuelve a su primera repetición desde hoy.
  await openRow('Sacar la basura');
  await A.click('#td-resume');
  await A.waitFor(`!${A.textIn('.todo', 'En pausa hasta')}`, 'que se quite la pausa');
  [t] = await todosOf('Sacar la basura');
  if (t.pausedUntil || t.pausedDue || t.dueDate >= until) throw new Error(`tras reanudar: ${JSON.stringify({ due: t.dueDate, until: t.pausedUntil })}`);
  // Vacaciones del grupo: todas las repetidas, hasta una fecha; y reanudar ya.
  const vac = await A.eval(`import('./js/dates.js').then((d) => d.addDays(d.todayKey(), 10))`);
  await A.tab('grupo');
  await A.fill('#vacation-until', vac);
  await A.click('#btn-vacation');
  await A.waitFor(`!!document.querySelector('#btn-vacation-end')`, 'el estado de vacaciones');
  if (process.env.SMOKE_SHOTS) { await A.eval(`document.querySelectorAll('.toast').forEach((t) => t.remove()); document.querySelector('#btn-vacation-end').scrollIntoView({ block: 'center' }); true`); await A.shot('vacaciones.png'); }
  const after = await A.eval(`import('./js/db.js').then(async (db) => { const { isRepeating } = await import('./js/dates.js'); return (await db.getAllRaw('todos')).filter((t) => !t.done && !t.deleted && isRepeating(t.repeat)).map((t) => [t.title, t.dueDate, t.pausedUntil]); })`);
  const wrong = after.filter(([, due, pu]) => due < vac || pu !== vac);
  if (!after.length || wrong.length) throw new Error(`vacaciones hasta ${vac}: ${JSON.stringify(after)}`);
  await A.click('#btn-vacation-end');
  await A.waitFor(`!!document.querySelector('#btn-vacation')`, 'que se reanuden las vacaciones');
  const left = await A.eval(`import('./js/db.js').then(async (db) => (await db.getAllRaw('todos')).filter((t) => !t.done && !t.deleted && t.pausedUntil).length)`);
  if (left) throw new Error(`quedan ${left} tareas en pausa`);
});

await run('Pospone (solo esta vez), Deshacer y «Pasan a hoy»', async () => {
  const day = (n) => A.eval(`import('./js/dates.js').then((d) => d.addDays(d.todayKey(), ${n}))`);
  const todoBy = (title) => A.eval(`import('./js/db.js').then(async (db) => (await db.getAllRaw('todos')).find((t) => t.title === ${q(title)} && !t.done && !t.deleted))`);
  const tomorrow = await day(1);
  // Desde Hoy: pulsación larga → Posponer → Mañana.
  await A.tab('hoy');
  await A.fill('#search-input', 'Llamar al fontanero');
  await A.eval(`document.querySelector('#search-add').requestSubmit(), true`);
  await A.waitFor(A.textIn('[data-tile-todo]', 'Llamar al fontanero'), 'la tarea en Hoy');
  await A.eval(`(() => { const el = [...document.querySelectorAll('[data-tile-todo]')].find((e) => e.textContent.includes('Llamar al fontanero')); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); return true; })()`);
  await A.waitFor(`!!document.querySelector('[data-postpone="1"]')`, 'los botones de posponer');
  if ((await A.eval(`document.querySelector('[data-postpone="1"]').textContent`)) !== 'Mañana') throw new Error('para una tarea de hoy el botón debe decir «Mañana»');
  if (process.env.SMOKE_SHOTS) await A.shot('posponer-modal.png');
  await A.eval(`document.querySelectorAll('.toast').forEach((t) => t.remove()), true`);
  await A.click('[data-postpone="1"]');
  await A.waitFor(`!(${A.textIn('[data-tile-todo]', 'Llamar al fontanero')})`, 'que salga de Hoy');
  if ((await todoBy('Llamar al fontanero')).dueDate !== tomorrow) throw new Error('no quedó para mañana');
  // +1 semana y Deshacer.
  await A.tab('proximas');
  await A.eval(`(() => { const r = [...document.querySelectorAll('.todo:not(.is-projected)')].find((e) => e.textContent.includes('Llamar al fontanero')); r.querySelector('[data-open]').click(); return true; })()`);
  await A.waitFor(`document.querySelector('[data-postpone="1"]')?.textContent === '+1 día'`, '«+1 día» para una tarea futura');
  await A.eval(`document.querySelectorAll('.toast').forEach((t) => t.remove()), true`);
  await A.click('[data-postpone="7"]');
  await A.waitFor(A.textIn('.toast__action', 'Deshacer'), 'el Deshacer');
  if ((await todoBy('Llamar al fontanero')).dueDate !== await day(8)) throw new Error('+1 semana debería contar desde mañana');
  await A.click('.toast__action', 'Deshacer');
  await A.eval('new Promise((r) => setTimeout(r, 300))');
  if ((await todoBy('Llamar al fontanero')).dueDate !== tomorrow) throw new Error('Deshacer no la devolvió a mañana');
  // Repetida: posponer un día no mueve el calendario de la serie.
  const vidrio = await todoBy('Sacar el vidrio');
  await A.eval(`(() => { const r = [...document.querySelectorAll('.todo:not(.is-projected)')].find((e) => e.textContent.includes('Sacar el vidrio')); r.querySelector('[data-open]').click(); return true; })()`);
  await A.waitFor(A.textIn('.field .help', 'Solo esta vez'), 'la nota «Solo esta vez»');
  await A.click('[data-postpone="1"]');
  await A.eval('new Promise((r) => setTimeout(r, 300))');
  const moved = await todoBy('Sacar el vidrio');
  const plus = (k, n) => A.eval(`import('./js/dates.js').then((d) => d.addDays(${q(k)}, ${n}))`);
  if (moved.dueDate !== await plus(vidrio.dueDate, 1) || moved.seriesDue !== vidrio.dueDate) throw new Error(`pospuesta: ${JSON.stringify(moved)}`);
  const next = await A.eval(`import('./js/db.js').then(async (db) => (await db.completeTodo(${q(moved.id)}, null)).next.dueDate)`);
  if (next !== await plus(vidrio.dueDate, 14)) throw new Error(`la siguiente es ${next}, debería ser ${await plus(vidrio.dueDate, 14)} (cada 2 semanas desde la original)`);
  // «Pasan a hoy»: una atrasada sin repetición deja de salir como atrasada.
  await A.eval(`(async () => {
    const db = await import('./js/db.js'); const { G } = await import('./js/state.js'); const d = await import('./js/dates.js');
    await db.addTodo({ groupId: G().id, title: 'Devolver el libro', icon: 'box', dueDate: d.addDays(d.todayKey(), -3) });
    return true;
  })()`);
  const badge = `(() => { const el = [...document.querySelectorAll('[data-tile-todo]')].find((e) => e.textContent.includes('Devolver el libro')); return !!el && !!el.querySelector('.tile__badge--danger'); })()`;
  await A.tab('hoy');
  await A.waitFor(badge, 'la atrasada con su aviso rojo');
  await A.tab('grupo');
  await A.check('#set-rollover', true);
  await A.tab('hoy');
  await A.waitFor(`!${badge} && ${A.textIn('[data-tile-todo]', 'Devolver el libro')}`, 'que pase a hoy sin aviso rojo');
  await A.tab('grupo');
  await A.check('#set-rollover', false);
});

await run('Escribir con naturalidad en el buscador y en el formulario', async () => {
  const todoBy = (title) => A.eval(`import('./js/db.js').then(async (db) => (await db.getAllRaw('todos')).find((t) => t.title === ${q(title)} && !t.done && !t.deleted))`);
  const expect = (text) => A.eval(`import('./js/parse.js').then((p) => p.parseTask(${q(text)}))`);
  await A.tab('hoy');
  // Fecha + repetición: chips y el título limpio en la casilla nueva.
  await A.fill('#search-input', 'Limpiar la terraza el viernes cada 2 semanas');
  await A.waitFor(`document.querySelectorAll('#search-results .parse-chip').length === 2 && ${A.textIn('.parse-chip', 'Cada 2 semanas')}`, 'los chips de fecha y repetición');
  await A.waitFor(A.textIn('.tile--new', 'Limpiar la terraza') + ` && !${A.textIn('.tile--new', 'viernes')}`, 'la casilla con el título limpio');
  if (process.env.SMOKE_SHOTS) await A.shot('parse-buscador.png');
  await A.click('.tile--new');
  await A.eval('new Promise((r) => setTimeout(r, 300))');
  const exp = await expect('Limpiar la terraza el viernes cada 2 semanas');
  const t1 = await todoBy('Limpiar la terraza');
  if (!t1 || t1.repeat !== '2w' || t1.dueDate !== exp.dueDate) throw new Error(`creada: ${JSON.stringify(t1 && { due: t1.dueDate, repeat: t1.repeat })}, se esperaba ${exp.dueDate} y 2w`);
  // Descartar un chip: la palabra vuelve al título.
  await A.fill('#search-input', 'Comprar pilas mañana');
  await A.waitFor(`!!document.querySelector('[data-ignore="date"]')`, 'el chip de la fecha');
  await A.click('[data-ignore="date"]');
  await A.waitFor(`!document.querySelector('.parse-chip') && ${A.textIn('.tile--new', 'Comprar pilas mañana')}`, 'el título completo tras descartar');
  // «para Juan» al pulsar Intro.
  await A.fill('#search-input', 'Bajar el reciclaje para Juan');
  await A.waitFor(A.textIn('.parse-chip', 'Juan'), 'el chip de Juan');
  await A.eval(`document.querySelector('#search-add').requestSubmit(), true`);
  await A.eval('new Promise((r) => setTimeout(r, 300))');
  const t2 = await todoBy('Bajar el reciclaje');
  const juan = await A.eval(`import('./js/state.js').then((s) => s.G().currentMemberId)`);
  if (!t2 || t2.assignee !== juan) throw new Error('no quedó asignada a Juan');
  // Formulario: «Aplicar» rellena título, fecha y repetición.
  await A.tab('proximas');
  await A.click('#fab-add');
  await A.waitFor(`!!document.querySelector('#td-title')`, 'el modal de tarea');
  await A.fill('#td-title', 'Pagar la luz el 1 de cada mes');
  await A.waitFor(`!document.querySelector('#td-parse').classList.contains('hidden') && ${A.textIn('#td-parse', 'Cada mes')}`, 'lo entendido con «Aplicar»');
  if (process.env.SMOKE_SHOTS) await A.shot('parse-formulario.png');
  await A.click('#td-parse-apply');
  const exp2 = await expect('Pagar la luz el 1 de cada mes');
  await A.waitFor(`document.querySelector('#td-title').value === 'Pagar la luz' && document.querySelector('#td-repeat').value === '1m' && document.querySelector('#td-date').value === ${q(exp2.dueDate)}`, 'el formulario rellenado');
  await A.click('#td-save');
  await A.waitFor(`!document.querySelector('.modal-overlay')`, 'que se cierre el modal');
  const t3 = await todoBy('Pagar la luz');
  if (!t3 || t3.repeat !== '1m' || t3.dueDate !== exp2.dueDate) throw new Error(`guardada: ${JSON.stringify(t3 && { due: t3.dueDate, repeat: t3.repeat })}`);
});

await run('Rutinas: lanzar, Deshacer, crear, editar y borrar', async () => {
  const pendingTitles = () => A.eval(`[...document.querySelectorAll('[data-tile-todo]')].map((e) => e.textContent.trim())`);
  await A.tab('hoy');
  await A.waitFor(A.textIn('[data-routine]', 'Limpieza del sábado'), 'la rutina de ejemplo');
  await A.eval(`document.querySelectorAll('.toast').forEach((t) => t.remove()), true`);
  await A.click('[data-routine]', 'Limpieza del sábado');
  await A.waitFor(A.textIn('.toast', 'tareas añadidas'), 'el aviso de tareas añadidas');
  const added = await pendingTitles();
  for (const t of ['Pasar la aspiradora', 'Fregar el suelo', 'Limpiar el baño', 'Quitar el polvo', 'Cambiar las sábanas']) {
    if (!added.some((x) => x.includes(t))) throw new Error(`falta «${t}» en Hoy`);
  }
  await A.waitFor(`document.querySelector('[data-routine]').classList.contains('tile--active')`, 'la rutina en color (todas pendientes)');
  // Otra vez: no duplica.
  await A.eval(`document.querySelectorAll('.toast').forEach((t) => t.remove()), true`);
  await A.click('[data-routine]', 'Limpieza del sábado');
  await A.waitFor(A.textIn('.toast', 'ya están pendientes'), 'que no duplique');
  // Deshacer quita las que añadió.
  await A.eval(`document.querySelectorAll('.toast').forEach((t) => t.remove()), true`);
  const ids = await A.eval(`import('./js/db.js').then(async (db) => (await db.getAllRaw('todos')).filter((t) => ['Pasar la aspiradora', 'Fregar el suelo', 'Limpiar el baño', 'Quitar el polvo', 'Cambiar las sábanas'].includes(t.title) && !t.deleted).map((t) => t.id))`);
  await A.eval(`(async () => { const db = await import('./js/db.js'); for (const id of ${JSON.stringify(ids)}) await db.deleteTodo(id); return true; })()`);
  await A.tab('hoy');
  await A.click('[data-routine]', 'Limpieza del sábado');
  await A.waitFor(A.textIn('.toast__action', 'Deshacer'), 'el Deshacer de la rutina');
  await A.click('.toast__action', 'Deshacer');
  await A.waitFor(`!${A.textIn('[data-tile-todo]', 'Quitar el polvo')}`, 'que Deshacer quite las tareas');
  // Crear una rutina con una tarea escrita y otra del catálogo.
  await A.click('#btn-new-routine');
  await A.waitFor(`!!document.querySelector('#rt-name')`, 'el formulario de rutina');
  await A.fill('#rt-name', 'Antes de dormir');
  await A.fill('#rt-new', 'Cerrar la puerta');
  await A.click('#rt-add');
  await A.click('[data-rpick]', 'Fregar los platos');
  await A.waitFor(`document.querySelectorAll('#rt-items [data-rm]').length === 2`, 'las dos tareas en la rutina');
  if (process.env.SMOKE_SHOTS) await A.shot('rutina-modal.png');
  await A.click('#rt-save');
  await A.waitFor(A.textIn('[data-routine]', 'Antes de dormir'), 'la rutina nueva en Hoy');
  if (process.env.SMOKE_SHOTS) { await A.eval(`document.querySelectorAll('.toast').forEach((t) => t.remove()); document.querySelector('[data-routine]').scrollIntoView({ block: 'center' }); true`); await A.shot('rutinas-hoy.png'); }
  // Pulsación larga → editar → eliminar.
  await A.eval(`(() => { const el = [...document.querySelectorAll('[data-routine]')].find((e) => e.textContent.includes('Antes de dormir')); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); return true; })()`);
  await A.waitFor(`document.querySelector('#rt-name')?.value === 'Antes de dormir' && document.querySelectorAll('#rt-items [data-rm]').length === 2`, 'el formulario con la rutina');
  await A.click('#rt-delete');
  await A.waitFor(`!!document.querySelector('.modal-overlay') && ${A.textIn('.modal', 'Eliminar')}`, 'la confirmación');
  await A.eval(`[...document.querySelectorAll('.modal .btn--danger, .modal .btn--primary')].find((b) => b.textContent.includes('Eliminar')).click(), true`);
  await A.waitFor(`!${A.textIn('[data-routine]', 'Antes de dormir')}`, 'que se borre la rutina');
});

await run('Las cinco pestañas responden', async () => {
  for (const v of ['hoy', 'proximas', 'hechas', 'grupo', 'ajustes']) await A.tab(v);
});

await run('Ajustes cambia el color y Grupo muestra la guía con el script', async () => {
  await A.eval(`document.querySelectorAll('[data-accent]')[2].click(), true`);
  await A.waitFor(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === document.querySelectorAll('[data-accent]')[2].dataset.accent`, 'el color de acento nuevo');
  await A.tab('grupo');
  await A.click('#btn-guide');
  await A.waitFor(`(document.querySelector('#gs-code')?.textContent || '').includes('function doGet')`, 'el código de Code.gs en la guía');
  await A.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true`);
});

await run('Service Worker: guarda la versión completa y arranca sin conexión', async () => {
  await A.waitFor('!!navigator.serviceWorker.controller', 'que el Service Worker controle la página', 10000);
  if (await A.eval(A.textIn('.toast', 'disponible'))) throw new Error('en la primera instalación no debe avisar de versión nueva');
  const shell = (await readFile(join(ROOT, 'sw.js'), 'utf8')).match(/const APP_SHELL = \[([\s\S]*?)\]/)[1].match(/'[^']+'/g).length;
  const cached = await A.eval(`caches.open('tareas-hogar-v${APP_VERSION}').then((c) => c.keys()).then((k) => k.length)`);
  if (cached < shell) throw new Error(`la caché tiene ${cached} archivos y APP_SHELL ${shell}`);
  // Sin conexión de verdad: se vacía la caché HTTP del navegador y se apaga el servidor.
  // Así todo tiene que salir de la caché del Service Worker (si falta un archivo, falla).
  await A.send('Network.clearBrowserCache');
  await new Promise((r) => { web.close(r); web.closeAllConnections(); });
  try {
    await A.reload();
    await A.waitFor(`document.querySelector('#header-title').textContent === 'Casa' && !!document.querySelector('#search-input')`, 'la app sin conexión');
  } finally {
    await listen(web, webPort);
  }
});

await run('Sincroniza con Google Sheets (simulado) entre dos móviles', async () => {
  await A.tab('grupo');
  await A.fill('#set-url', GAS);
  await A.click('#btn-savesync');
  await until(() => rows('members').length === 1 && rows('categories').length > 0, 'que el móvil A suba el grupo a la hoja');

  const invite = Buffer.from(JSON.stringify({ v: 2, groupName: 'Casa', syncUrl: GAS, syncSecret: '', ntfyServer: 'https://ntfy.sh', ntfyTopic: '' })).toString('base64url');
  B = await openPhone('movil-B');
  await B.goto(`${BASE}#join=${invite}`);
  await B.waitFor(`!!document.querySelector('#ob-join')`, 'el formulario para unirse');
  await B.fill('#ob-name', 'Ana');
  await B.click('#ob-join');
  await B.waitFor(`document.querySelector('#header-title').textContent === 'Casa' && !!document.querySelector('#search-input')`, 'que B entre en «Casa»');
  await until(() => rows('members').length === 2, 'que Ana llegue a la hoja');

  await B.fill('#search-input', 'Poner la lavadora');
  await B.eval(`document.querySelector('#search-add').requestSubmit(), true`);
  await until(() => rows('todos').some((r) => r.data && r.data.title === 'Poner la lavadora'), 'que la tarea de B llegue a la hoja', 8000);

  await A.tab('hoy');
  await A.click('#btn-sync');
  await A.waitFor(A.textIn('[data-tile-todo]', 'Poner la lavadora'), 'que A vea la tarea de B');
  await A.tab('grupo');
  await A.waitFor(A.textIn('#view', 'Ana'), 'que A vea a Ana en el grupo');
  await B.tab('hoy');
  await B.waitFor(B.textIn('[data-routine]', 'Limpieza del sábado'), 'que B reciba la rutina por la hoja');
  if (rows('routines').length !== 1) throw new Error(`la hoja tiene ${rows('routines').length} rutinas (debería ser 1)`);
  const cats = rows('categories').length;
  if (cats !== DEFAULT_CATALOG.length) throw new Error(`la hoja tiene ${cats} categorías (deberían ser ${DEFAULT_CATALOG.length}): catálogo duplicado`);
});

await run('Avisos: cada persona su tema y nadie recibe los suyos', async () => {
  // Los dos móviles publican en el ntfy simulado.
  for (const P of [A, B]) await P.eval(`(async () => { const db = await import('./js/db.js'); const s = await import('./js/state.js'); s.state.settings = await db.updateGroup(s.G().id, { ntfyServer: ${q(NTFY)} }); return true; })()`);
  // Ana (B) recibe avisos desde que se unió; Juan (A) los activa ahora.
  await A.tab('grupo');
  await A.check('#set-notify', true);
  await A.waitFor(`!!document.querySelector('#btn-subscribe')`, 'el botón «Suscribirme»');
  const href = await A.eval(`document.querySelector('#btn-subscribe').getAttribute('href')`);
  if (!href.startsWith(`ntfy://127.0.0.1:${ntfyPort}/`) || !href.includes('secure=false') || !href.includes('display=Casa')) throw new Error(`enlace de suscripción: ${href}`);
  if (process.env.SMOKE_SHOTS) { await A.eval(`document.querySelectorAll('.toast').forEach((t) => t.remove()); document.querySelector('#btn-subscribe').scrollIntoView({ block: 'center' }); true`); await A.shot('avisos-grupo.png'); }
  const topicOf = (P) => P.eval(`(async () => { const db = await import('./js/db.js'); const s = await import('./js/state.js'); return (await db.getOne('members', s.G().currentMemberId)).ntfyTopic; })()`);
  const [topicA, topicB] = [await topicOf(A), await topicOf(B)];
  if (!topicA || !topicB || topicA === topicB) throw new Error(`temas: A=${topicA} B=${topicB}`);
  // Sincronizar para que cada uno sepa el tema del otro.
  await A.click('#btn-sync'); await A.eval('new Promise((r) => setTimeout(r, 600))');
  await B.click('#btn-sync'); await B.eval('new Promise((r) => setTimeout(r, 600))');
  await A.click('#btn-sync'); await A.eval('new Promise((r) => setTimeout(r, 600))');
  // A añade → solo B. B resuelve → solo A.
  published.length = 0;
  await A.tab('hoy');
  await A.fill('#search-input', 'Comprar fruta');
  await A.eval(`document.querySelector('#search-add').requestSubmit(), true`);
  await until(() => published.length >= 1, 'el aviso de A');
  await A.eval('new Promise((r) => setTimeout(r, 300))');
  if (published.length !== 1 || published[0].topic !== topicB || !published[0].message.includes('Comprar fruta')) throw new Error(`avisos al añadir: ${JSON.stringify(published.map((p) => [p.topic, p.message]))}`);
  await until(() => rows('todos').some((r) => r.data && r.data.title === 'Comprar fruta'), 'que la tarea de A llegue a la hoja', 8000);
  await B.tab('hoy');
  await B.click('#btn-sync');
  await B.waitFor(B.textIn('[data-tile-todo]', 'Comprar fruta'), 'la tarea en B');
  published.length = 0;
  await B.click('[data-tile-todo]', 'Comprar fruta');
  await until(() => published.length >= 1, 'el aviso de B');
  await B.eval('new Promise((r) => setTimeout(r, 300))');
  if (published.length !== 1 || published[0].topic !== topicA || !published[0].message.includes('resuelto')) throw new Error(`avisos al resolver: ${JSON.stringify(published.map((p) => [p.topic, p.message]))}`);
  // Asignar al crear: Ana recibe solo «te ha asignado» (no además el aviso normal).
  const anaId = await B.eval(`import('./js/state.js').then((s) => s.G().currentMemberId)`);
  const juanId = await A.eval(`import('./js/state.js').then((s) => s.G().currentMemberId)`);
  const newTask = async (title, who) => {
    await A.tab('hoy');
    await A.click('#fab-add');
    await A.waitFor(`!!document.querySelector('#td-title')`, 'el modal de tarea');
    await A.fill('#td-title', title);
    if (who) await A.click(`[data-mid="${who}"]`);
    await A.click('#td-save');
    await A.waitFor(`!document.querySelector('.modal-overlay')`, 'que se cierre el modal');
    await A.eval('new Promise((r) => setTimeout(r, 400))');
  };
  const sent = () => JSON.stringify(published.map((p) => [p.topic === topicA ? 'A' : p.topic === topicB ? 'B' : p.topic, p.message]));
  published.length = 0;
  await newTask('Tender la ropa', anaId);
  if (published.length !== 1 || published[0].topic !== topicB || !published[0].message.includes('te ha asignado «Tender la ropa» para hoy')) throw new Error(`al asignar a Ana: ${sent()}`);
  // Asignada a quien la crea: aviso normal a Ana.
  published.length = 0;
  await newTask('Llamar a la abuela', juanId);
  if (published.length !== 1 || !published[0].message.includes('ha añadido «Llamar a la abuela»')) throw new Error(`asignada a Juan: ${sent()}`);
  // Editar y cambiar a Ana: solo «te ha asignado»; editar otra cosa no avisa.
  published.length = 0;
  const editTask = async (title, fn) => {
    await A.tab('hoy');
    await A.eval(`(() => { const el = [...document.querySelectorAll('[data-tile-todo]')].find((e) => e.textContent.includes(${q(title)})); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); return true; })()`);
    await A.waitFor(`document.querySelector('#td-title')?.value === ${q(title)}`, 'el modal de edición');
    await fn();
    await A.click('#td-save');
    await A.waitFor(`!document.querySelector('.modal-overlay')`, 'que se cierre el modal');
    await A.eval('new Promise((r) => setTimeout(r, 400))');
  };
  await editTask('Llamar a la abuela', () => A.click(`[data-mid="${anaId}"]`));
  if (published.length !== 1 || published[0].topic !== topicB || !published[0].message.includes('te ha asignado «Llamar a la abuela»')) throw new Error(`al reasignar: ${sent()}`);
  published.length = 0;
  await editTask('Llamar a la abuela', () => A.fill('#td-note', 'Por la tarde'));
  if (published.length) throw new Error(`editar sin cambiar la persona no debe avisar: ${sent()}`);
  // «Probar» va a tu propio tema.
  published.length = 0;
  await A.tab('grupo');
  await A.click('#btn-notify-test');
  await until(() => published.length === 1, 'el aviso de prueba');
  if (published[0].topic !== topicA) throw new Error('la prueba debería ir a tu tema');
});

await run('Sincronización incremental: sin cambios no se envía ni se recibe nada', async () => {
  await A.tab('hoy');
  await A.click('#btn-sync');
  await A.eval('new Promise((r) => setTimeout(r, 500))');
  gasLog.length = 0;
  await A.click('#btn-sync');
  await until(() => gasLog.length >= 1, 'la petición de sincronización');
  const last = gasLog[gasLog.length - 1];
  if (last.action !== 'sync' || last.sent !== 0 || last.got !== 0 || last.full) throw new Error(`sin cambios: ${JSON.stringify(last)}`);
  // Un cambio en B: A recibe solo ese registro.
  await B.tab('hoy');
  await B.fill('#search-input', 'Comprar sal');
  await B.eval(`document.querySelector('#search-add').requestSubmit(), true`);
  await until(() => rows('todos').some((r) => r.data.title === 'Comprar sal'), 'que la tarea de B llegue a la hoja', 8000);
  gasLog.length = 0;
  await A.click('#btn-sync');
  await A.waitFor(A.textIn('[data-tile-todo]', 'Comprar sal'), 'que A reciba la tarea de B');
  const got = gasLog.find((l) => l.action === 'sync');
  if (!got || got.got !== 1) throw new Error(`A debería recibir 1 registro: ${JSON.stringify(gasLog)}`);
  await A.tab('grupo');
  await A.waitFor(A.textIn('#view', 'script v2'), '«script v2» en Grupo');
});

await run('Archivo: lo que el script archiva desaparece también del otro móvil', async () => {
  // A tiene una tarea hecha hace 100 días (p. ej. de una copia de seguridad) y la sube.
  await A.eval(`(async () => {
    const db = await import('./js/db.js'); const { G } = await import('./js/state.js');
    const old = Date.now() - 100 * 24 * 3600 * 1000;
    await db.putRaw('todos', { id: 'vieja-1', groupId: G().id, title: 'Tarea vieja', icon: 'box', dueDate: '2026-07-01', repeat: 'none', done: true, doneAt: old, doneBy: null, createdAt: old, seriesId: 'vieja-1', updatedAt: Date.now(), deleted: false });
    return true;
  })()`);
  await A.click('#btn-sync');
  await until(() => rows('todos').some((r) => r.id === 'vieja-1'), 'que llegue a la hoja', 8000);
  await B.click('#btn-sync');
  await B.waitFor(`import('./js/db.js').then(async (db) => !!(await db.getOne('todos', 'vieja-1')))`, 'que B la reciba');
  // Al día siguiente el script la archiva; B recibe la lista completa y la quita.
  gasSim.props.set('lastPurge', '0');
  await A.click('#btn-sync');
  await until(() => gasSim.sheetRows('archivo').some((r) => r[1] === 'vieja-1'), 'que el script la archive', 8000);
  await B.click('#btn-sync');
  await B.waitFor(`import('./js/db.js').then(async (db) => !(await db.getOne('todos', 'vieja-1')))`, 'que B la quite');
  // Lo demás sigue en B.
  if (!(await B.eval(`import('./js/db.js').then(async (db) => (await db.getAllRaw('todos')).some((t) => t.title === 'Comprar sal'))`))) throw new Error('B perdió tareas que no estaban archivadas');
});

await run('Resumen diario: activarlo, instalar el activador y recibirlo', async () => {
  await A.tab('grupo');
  await A.check('#set-summary', true);
  await A.waitFor(A.textIn('.summary-status', 'instalarResumenDiario'), 'el aviso de que falta instalarlo');
  gasSim.ctx.instalarResumenDiario();
  const hour = await A.eval('new Date().getHours()');
  await A.fill('#set-summary-hour', String(hour));
  await A.eval('new Promise((r) => setTimeout(r, 300))');
  await A.click('#btn-sync');
  await A.waitFor(A.textIn('.summary-status', `a las ${hour}:00`), 'el resumen listo');
  if (process.env.SMOKE_SHOTS) { await A.eval(`document.querySelectorAll('.toast').forEach((t) => t.remove()); document.querySelector('#set-summary').scrollIntoView({ block: 'center' }); true`); await A.shot('resumen-diario.png'); }
  await until(() => rows('members').some((m) => m.data.summaryHour === hour), 'la hora del resumen en la hoja', 8000);
  const topicA = await A.eval(`(async () => { const db = await import('./js/db.js'); const s = await import('./js/state.js'); return (await db.getOne('members', s.G().currentMemberId)).ntfyTopic; })()`);
  gasSim.fetches.length = 0;
  if (gasSim.ctx.resumenDiario() !== 1) throw new Error(`resumen enviado a ${gasSim.fetches.length}`);
  const f = gasSim.fetches[0];
  if (f.body.topic !== topicA || f.body.title !== 'Casa · hoy' || !/tareas?/.test(f.body.message)) throw new Error(`resumen: ${JSON.stringify(f.body)}`);
  if (gasSim.ctx.resumenDiario() !== 0) throw new Error('el resumen solo debe llegar una vez al día');
});

await run('Script antiguo (v1): sigue sincronizando y avisa de que hay que actualizarlo', async () => {
  await A.switchGroup('Mis cosas');
  await A.tab('grupo');
  await A.fill('#set-url', `http://127.0.0.1:${gasPort}/macros/s/v1/exec`);
  await A.click('#btn-savesync');
  await A.waitFor(`!!document.querySelector('.warn-box') && ${A.textIn('.warn-box', 'script de Google es antiguo')}`, 'el aviso de script antiguo');
  if (await A.eval(`document.querySelector('#btn-sync').classList.contains('has-error')`)) throw new Error('con el script v1 la sincronización debería funcionar');
  if (!gasV1.sheetRows().slice(1).some((r) => r[0] === 'categories')) throw new Error('la app no subió los datos con el protocolo antiguo');
  await A.click('#btn-script-update');
  await A.waitFor(A.textIn('.modal', 'Nueva versión') + ' && ' + A.textIn('.modal', 'instalarResumenDiario'), 'la guía para actualizar');
  await A.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true`);
  await A.switchGroup('Casa');
});

await run('Diagnóstico: registra el error de Google sin filtrar la clave', async () => {
  await A.switchGroup('Mis cosas');
  await A.waitFor(`document.querySelector('#header-title').textContent === 'Mis cosas'`, 'el grupo «Mis cosas»');
  await A.tab('grupo');
  await A.fill('#set-url', `http://127.0.0.1:${gasPort}/macros/s/denegado/exec`);
  await A.fill('#set-secret', 'clave-super-secreta');
  await A.eval(`document.querySelectorAll('.toast').forEach((t) => t.remove()), true`);
  await A.click('#btn-savesync');
  await A.waitFor(A.textIn('.toast__action', 'Detalles'), 'el toast de error con «Detalles»');
  await A.waitFor(`document.querySelector('#btn-sync').classList.contains('has-error')`, 'el punto rojo en el botón de sincronizar');
  // Un error de JavaScript también queda registrado.
  await A.eval(`setTimeout(() => { throw new Error('prueba-diag'); }), true`);
  await A.eval('new Promise((r) => setTimeout(r, 300))');
  await A.click('.toast__action', 'Detalles');
  await A.waitFor(A.textIn('#diag-log', 'Google no permite el acceso'), 'el error de sincronización en el registro');
  await A.waitFor(A.textIn('#diag-log', 'prueba-diag'), 'el error de JavaScript en el registro');
  const report = await A.eval(`document.querySelector('#diag-report').value`);
  if (!/cors/i.test(report)) throw new Error('el informe no explica el bloqueo CORS');
  if (report.includes('clave-super-secreta') || report.includes('token=')) throw new Error('el informe filtra la clave');
  if (process.env.SMOKE_SHOTS) await A.shot('diagnostico-modal.png');
  await A.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true`);
  await A.tab('ajustes');
  await A.waitFor(A.textIn('#view', 'en las últimas 24 h') + ` && !${A.textIn('#view', 'Sin errores en las últimas 24 h')}`, 'los errores recientes en Ajustes');
  // Al volver a «Casa» (que sincroniza bien) no hay punto rojo.
  await A.switchGroup('Casa');
  await A.waitFor(`!document.querySelector('#btn-sync').classList.contains('has-error')`, 'sin punto rojo en «Casa»');
});

await run('Avisa de una versión nueva y «Recargar» la carga', async () => {
  // «Publicar» la 9.9.9: el Service Worker nuevo se instala con la app abierta.
  overrides.set('/sw.js', (s) => s.replace(/CACHE_VERSION = '[^']+'/, "CACHE_VERSION = 'v9.9.9'"));
  overrides.set('/js/changelog.js', (s) => s.replace(/APP_VERSION = '[^']+'/, "APP_VERSION = '9.9.9'"));
  await A.eval(`document.querySelectorAll('.toast').forEach((t) => t.remove()), true`);
  await A.eval('navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => true)');
  await A.waitFor(A.textIn('.toast', 'Versión 9.9.9 disponible'), 'el aviso «Versión 9.9.9 disponible»', 10000);
  await A.eval('window.__tareasBooted = false');
  await A.click('.toast__action', 'Recargar');
  await A.waitFor(`window.__tareasBooted === true && document.querySelector('#header-version').textContent === 'v9.9.9'`, 'la versión 9.9.9 tras recargar', 10000);
  overrides.clear();
});

await run('Sin errores de JavaScript', async () => {
  const errs = pages.flatMap((p) => p.errors.filter((e) => !e.includes('prueba-diag')).map((e) => `[${p.name}] ${e.split('\n')[0]}`));
  if (errs.length) throw new Error(errs.join('\n    '));
});

/* ------------------------------- Cierre -------------------------------- */
async function cleanup() {
  try { cdp?.ws.close(); } catch { /* ya cerrado */ }
  chrome.kill();
  web.closeAllConnections?.(); web.close();
  gas.close();
  ntfy.close();
  await sleep(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
await cleanup();
if (!failed && !process.env.SMOKE_SHOTS) await rm(OUT, { recursive: true, force: true });
if (process.env.SMOKE_SHOTS) console.log(`Capturas en ${OUT}`);
console.log(failed ? '\nFALLO' : '\nTodo correcto');
process.exit(failed ? 1 : 0);
