/* Punto de entrada y orquestación de la interfaz. */
import * as db from './db.js';
import { syncNow, testConnection } from './sync.js';
import { APP_VERSION, CHANGELOG, compareVersions } from './changelog.js';
import { icon, TASK_ICONS } from './icons.js';
import { notify, flushQueue, testNotify, randomTopic, isValidTopic, topicUrl } from './notify.js';
import { ymd, parseYmd, todayKey, addDays, REPEATS } from './dates.js';
import { CATALOG, searchCatalog, guessIcon, normalizeTitle } from './catalog.js';

/* =============================== Constantes ============================== */
const ACCENTS = ['#4f8cff', '#7c5cff', '#ff5c8a', '#ff7a45', '#f5b545', '#35c98b', '#22c3d6', '#8b5cf6', '#ef4444', '#14b8a6'];
const MEMBER_COLORS = ['#4f8cff', '#ff5c8a', '#35c98b', '#f5b545', '#7c5cff', '#ff7a45', '#22c3d6', '#ef4444'];
const DEFAULT_GROUP = 'Tareas Hogar';

/* Código de Google Apps Script que el usuario debe pegar (copiar botón). */
const APPS_SCRIPT_CODE = `/**
 * Backend de sincronizacion para "Tareas del Hogar".
 * Pegar en Extensiones > Apps Script y desplegar como Aplicacion web
 * (Ejecutar como: Yo | Quien tiene acceso: Cualquier persona).
 */
var SHEET_NAME = 'tareas_data';
var SECRET = ''; // Opcional: pon una clave aqui y la misma en la app.

function doGet(e)  { return handle_(e); }
function doPost(e) { return handle_(e); }

function handle_(e) {
  var out = { ok: false };
  try {
    var params = (e && e.parameter) || {};
    var body = {};
    if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (err) {}
    }
    var action = body.action || params.action || 'pull';
    var token  = body.token  || params.token  || '';
    if (SECRET && token !== SECRET) return json_({ ok: false, error: 'unauthorized' });

    var sheet = getSheet_();
    if (action === 'pull') {
      out = { ok: true, records: readAll_(sheet) };
    } else if (action === 'push') {
      upsert_(sheet, body.records || []);
      out = { ok: true, records: readAll_(sheet) };
    } else {
      out = { ok: false, error: 'accion desconocida' };
    }
  } catch (err) { out = { ok: false, error: String(err) }; }
  return json_(out);
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['store', 'id', 'updatedAt', 'deleted', 'json']);
  }
  return sheet;
}

function readAll_(sheet) {
  var values = sheet.getDataRange().getValues();
  var records = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[1]) continue;
    var data = {};
    try { data = JSON.parse(row[4] || '{}'); } catch (e) {}
    records.push({
      store: row[0], id: String(row[1]),
      updatedAt: Number(row[2]) || 0,
      deleted: row[3] === true || row[3] === 1 || row[3] === '1',
      data: data
    });
  }
  return records;
}

function upsert_(sheet, records) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var values = sheet.getDataRange().getValues();
    var index = {};
    for (var i = 1; i < values.length; i++) {
      index[values[i][0] + '::' + values[i][1]] = { row: i + 1, updatedAt: Number(values[i][2]) || 0 };
    }
    var toAppend = [];
    for (var j = 0; j < records.length; j++) {
      var r = records[j];
      var rowValues = [r.store, r.id, Number(r.updatedAt) || 0, r.deleted ? 1 : 0, JSON.stringify(r.data || {})];
      var found = index[r.store + '::' + r.id];
      if (found && found.row > 0) {
        if ((Number(r.updatedAt) || 0) >= found.updatedAt) {
          sheet.getRange(found.row, 1, 1, 5).setValues([rowValues]);
        }
      } else if (!found) {
        toAppend.push(rowValues);
        index[r.store + '::' + r.id] = { row: -1, updatedAt: 0 };
      }
    }
    if (toAppend.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, 5).setValues(toAppend);
    }
  } finally { lock.releaseLock(); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`;

/* =============================== Estado ================================== */
const state = {
  view: 'hoy',
  settings: null,
  showDoneToday: false,
  search: ''
};

/* =============================== Utilidades ============================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = () => $('#view');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}
function contrastColor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#111318' : '#ffffff';
}
function startOfWeek(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}
const fmtTime = (ts) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(ts);
const fmtDate = (ts) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(ts);
const fmtLongDate = (d) => new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
const fmtShortDay = (d) => new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(',', '');
function relativeDay(ts) {
  const k = ymd(new Date(ts)), t = todayKey();
  if (k === t) return 'Hoy';
  if (k === addDays(t, -1)) return 'Ayer';
  return fmtDate(ts);
}
/** Etiqueta corta de un vencimiento 'YYYY-MM-DD'. */
function dueLabel(key) {
  const t = todayKey();
  if (key === t) return 'Hoy';
  if (key === addDays(t, 1)) return 'Mañana';
  if (key === addDays(t, -1)) return 'Ayer';
  return fmtShortDay(parseYmd(key));
}
/** Para los avisos: "para hoy", "para mañana", "para el vie 31 oct". */
function dueForText(key) {
  const l = dueLabel(key);
  return l === 'Hoy' || l === 'Mañana' ? `para ${l.toLowerCase()}` : `para el ${l}`;
}
function hasGroup() { return !!state.settings.groupName; }

/* ================================ Toasts ================================= */
function toast(msg, type = '', { action } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' toast--' + type : '');
  el.innerHTML = (type === 'ok' ? icon('check') : type === 'err' ? icon('x') : '') + `<span>${esc(msg)}</span>`
    + (action ? `<button class="toast__action">${esc(action.label)}</button>` : '');
  if (action) $('.toast__action', el).onclick = () => { el.remove(); action.fn(); };
  $('#toast-root').appendChild(el);
  const life = action ? 4500 : 2400;
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, life);
  setTimeout(() => el.remove(), life + 400);
}

/* ================================ Modales ================================ */
function openModal(title, bodyHTML, { onMount, wide } = {}) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="${wide ? 'max-width:640px' : ''}" role="dialog" aria-modal="true">
      <div class="modal__grip"></div>
      <div class="modal__head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Cerrar">${icon('x')}</button>
      </div>
      <div class="modal__body">${bodyHTML}</div>
    </div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.hasAttribute('data-close') || e.target.closest('[data-close]')) closeModal();
  });
  $('#modal-root').appendChild(overlay);
  document.body.style.overflow = 'hidden';
  if (onMount) onMount($('.modal', overlay));
  return overlay;
}
function closeModal() {
  const m = $('.modal-overlay');
  if (m) m.remove();
  document.body.style.overflow = '';
}
function confirmDialog(message, { danger = false, okText = 'Aceptar' } = {}) {
  return new Promise((resolve) => {
    openModal('Confirmar', `
      <p style="margin:4px 0 18px;line-height:1.5">${esc(message)}</p>
      <div class="modal__actions">
        <button class="btn btn--ghost" data-no>Cancelar</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-yes>${esc(okText)}</button>
      </div>`, {
      onMount(modal) {
        $('[data-no]', modal).onclick = () => { closeModal(); resolve(false); };
        $('[data-yes]', modal).onclick = () => { closeModal(); resolve(true); };
      }
    });
  });
}

/* ============================ Tema y acento ============================= */
function applyAppearance() {
  const { accent, theme } = state.settings;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-contrast', contrastColor(accent));
  const bg = theme === 'light' ? '#f4f6fb' : '#0f1115';
  $('#meta-theme-color').setAttribute('content', bg);
}
function applyShell() {
  document.body.classList.toggle('no-group', !hasGroup());
  $('#header-title').textContent = state.settings.groupName || 'Tareas del Hogar';
}

/* ============================ Sincronización ============================ */
const POLL_MS = 60 * 1000; // Con la app visible, traer cambios del grupo cada minuto.
let autoSyncTimer = null;
let pollTimer = null;
let syncing = null; // Promise de la sincronización en curso (evita solapes).

function scheduleAutoSync() {
  if (!state.settings.autoSync || !state.settings.syncUrl) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => doSync(true), 1500);
}
async function doSync(silent = false) {
  if (!state.settings.syncUrl) {
    if (!silent) toast('Configura la sincronización en la pestaña Grupo', 'err');
    return;
  }
  if (syncing) return syncing;
  const btn = $('#btn-sync');
  btn.classList.add('is-spinning');
  syncing = (async () => {
    try {
      const res = await syncNow();
      state.settings = await db.getSettings();
      if (!silent) toast(`Sincronizado (${res.pulled} recibidos)`, 'ok');
      // En segundo plano solo repintamos si llegó algo, para no mover el
      // scroll ni cerrar nada sin motivo.
      if (!silent || res.pulled > 0) await refreshKeepingScroll();
    } catch (err) {
      if (!silent) toast('Error al sincronizar: ' + err.message, 'err');
      console.warn('Sync error', err);
    } finally {
      btn.classList.remove('is-spinning');
      syncing = null;
    }
  })();
  return syncing;
}
async function refreshKeepingScroll() {
  if ($('.modal-overlay')) return; // No repintar debajo de un formulario abierto.
  const a = document.activeElement;
  if (a && a.matches('input, textarea, select') && view().contains(a)) return; // Ni mientras se escribe.
  const y = window.scrollY;
  await refresh();
  window.scrollTo(0, y);
}

/* Sincroniza al abrir la app, al volver a ella, al recuperar la red y
 * periódicamente mientras está visible. */
function startBackgroundSync() {
  const tick = () => {
    flushQueue().catch(() => {});
    if (state.settings.syncUrl && state.settings.autoSync) doSync(true);
  };
  const startPoll = () => { clearInterval(pollTimer); pollTimer = setInterval(tick, POLL_MS); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { tick(); startPoll(); }
    else clearInterval(pollTimer);
  });
  window.addEventListener('online', tick);
  tick();
  startPoll();
}

/* ============================= Notificaciones =========================== */
async function memberName(id) {
  if (!id) return null;
  const m = await db.getOne('members', id);
  return m && !m.deleted ? m.name : null;
}
/* Los avisos no bloquean la interfaz: si falla la red se encolan solos. */
async function notifyCreated(todo) {
  const who = (await memberName(state.settings.currentMemberId)) || 'Alguien';
  const forWhom = todo.assignee ? ` (le toca a ${(await memberName(todo.assignee)) || '?'})` : '';
  notify({ message: `${who} ha añadido «${todo.title}» ${dueForText(todo.dueDate)}${forWhom}`, tags: ['heavy_plus_sign'] });
}
async function notifyResolved(todo) {
  const who = (await memberName(state.settings.currentMemberId)) || 'Alguien';
  notify({ message: `${who} ha resuelto «${todo.title}»`, tags: ['white_check_mark'] });
}

/* ========================== Acciones sobre tareas ======================= */
async function completeTodo(id) {
  const { todo, next } = await db.completeTodo(id, state.settings.currentMemberId);
  if (!todo) return;
  scheduleAutoSync();
  notifyResolved(todo);
  toast(next ? `Resuelta · vuelve ${dueLabel(next.dueDate).toLowerCase()}` : 'Resuelta', 'ok', {
    action: { label: 'Deshacer', fn: () => reopenTodo(id, true) }
  });
  await refreshKeepingScroll();
}
async function reopenTodo(id, quiet = false) {
  await db.reopenTodo(id);
  scheduleAutoSync();
  if (!quiet) toast('Vuelve a estar pendiente');
  await refreshKeepingScroll();
}

/* ============================== Router ================================== */
async function setView(v) {
  state.view = v;
  $$('.tabbar__item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === v));
  await refresh();
  window.scrollTo(0, 0);
}
async function refresh() {
  applyShell();
  if (!hasGroup()) return renderOnboarding();
  const v = state.view;
  if (v === 'hoy') return renderHoy();
  if (v === 'proximas') return renderProximas();
  if (v === 'hechas') return renderHechas();
  if (v === 'grupo') return renderGrupo();
  if (v === 'ajustes') return renderAjustes();
}

/* ========================= Pieza: fila de tarea ========================= */
function avatar(m, size = 'sm') {
  return `<span class="avatar avatar--${size}" style="background:${esc(m.color)};color:${contrastColor(m.color)}">${esc(initials(m.name))}</span>`;
}
function todoRow(t, memById, { hideDate = false } = {}) {
  const today = todayKey();
  const overdue = !t.done && t.dueDate < today;
  const meta = [];
  if (t.done) {
    const by = memById.get(t.doneBy);
    meta.push(`<span class="meta-item">${icon('check-circle')}${by ? esc(by.name) : 'Resuelta'} · ${relativeDay(t.doneAt)} ${fmtTime(t.doneAt)}</span>`);
  } else if (overdue) {
    meta.push(`<span class="meta-item meta-item--danger">${icon('alert')}${esc(dueLabel(t.dueDate))}</span>`);
  } else if (t.dueDate !== today && !hideDate) {
    meta.push(`<span class="meta-item">${icon('calendar')}${esc(dueLabel(t.dueDate))}</span>`);
  }
  const who = memById.get(t.assignee);
  if (who && !t.done) meta.push(`<span class="meta-item">${avatar(who, 'xs')}${esc(who.name)}</span>`);
  if (t.repeat && t.repeat !== 'none') meta.push(`<span class="meta-item">${icon('repeat')}${esc(REPEATS[t.repeat])}</span>`);
  if (t.note) meta.push(`<span class="meta-item">${icon('note')}${esc(t.note)}</span>`);

  return `<div class="todo ${t.done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''}">
    <button class="todo__check" data-check="${esc(t.id)}" aria-label="${t.done ? 'Marcar como pendiente' : 'Marcar como resuelta'}">${icon('check')}</button>
    <div class="todo__body" data-open="${esc(t.id)}">
      <div class="todo__title">${icon(t.icon || 'sparkles')}<span>${esc(t.title)}</span></div>
      ${meta.length ? `<div class="todo__meta">${meta.join('')}</div>` : ''}
    </div>
  </div>`;
}
function todoList(items, memById, opts) {
  return `<div class="card card--pad0">${items.map((t) => todoRow(t, memById, opts)).join('')}</div>`;
}
function wireTodoRows(all) {
  $$('[data-check]').forEach((b) => b.onclick = () => {
    const t = all.find((x) => x.id === b.dataset.check);
    if (!t) return;
    t.done ? reopenTodo(t.id) : completeTodo(t.id);
  });
  $$('[data-open]').forEach((b) => b.onclick = () => openTodoModal({ todo: all.find((x) => x.id === b.dataset.open) }));
}
function emptyCard(iconName, html) {
  return `<div class="card empty"><span class="empty__emoji">${icon(iconName)}</span>${html}</div>`;
}
const fab = (label) => `<button class="fab" id="fab-add" aria-label="${esc(label)}">${icon('plus')}</button>`;

/* ============================ Vista: HOY ================================ */
/* Inspirada en las listas de la compra tipo Bring: arriba las pendientes en
 * casillas de color (un toque = resuelta), debajo recientes y catálogo en
 * casillas grises (un toque = pendiente para hoy). */
function tile({ title, iconName, active, overdue, cls = '', extra = '', attrs = '' }) {
  return `<button class="tile ${active ? 'tile--active' : ''} ${overdue ? 'tile--overdue' : ''} ${cls}" ${attrs}>
    ${extra}
    <span class="tile__icon">${icon(iconName)}</span>
    <span class="tile__name">${esc(title)}</span>
  </button>`;
}

async function renderHoy() {
  const [members, all] = await Promise.all([db.members(), db.todos()]);
  const memById = new Map(members.map((m) => [m.id, m]));
  const today = todayKey();
  const pending = all.filter((t) => !t.done && t.dueDate <= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt - b.createdAt);
  const doneToday = all.filter((t) => t.done && ymd(new Date(t.doneAt)) === today).sort((a, b) => b.doneAt - a.doneAt);
  const pendingByTitle = new Map(pending.map((t) => [normalizeTitle(t.title), t]));
  const upcomingCount = all.filter((t) => !t.done && t.dueDate > today).length;

  // Recientes: títulos usados que no están en el catálogo ni pendientes ahora.
  const catalogTitles = new Set(CATALOG.flatMap((c) => c.items.map((i) => normalizeTitle(i.name))));
  const recent = [];
  const seen = new Set();
  for (const t of [...all].sort((a, b) => (b.doneAt || b.createdAt) - (a.doneAt || a.createdAt))) {
    const k = normalizeTitle(t.title);
    if (seen.has(k) || catalogTitles.has(k) || pendingByTitle.has(k)) continue;
    seen.add(k); recent.push(t);
    if (recent.length >= 8) break;
  }

  const pendingTile = (t) => {
    const who = memById.get(t.assignee);
    const overdue = t.dueDate < today;
    const badges = [
      overdue ? `<span class="tile__badge tile__badge--danger" title="Atrasada">${icon('alert')}</span>` : '',
      t.repeat !== 'none' ? `<span class="tile__badge" title="${esc(REPEATS[t.repeat])}">${icon('repeat')}</span>` : '',
      who ? avatar(who, 'xs') : ''
    ].join('');
    return tile({ title: t.title, iconName: t.icon, active: true, overdue,
      extra: badges ? `<span class="tile__badges">${badges}</span>` : '',
      attrs: `data-tile-todo="${esc(t.id)}" aria-label="Resolver ${esc(t.title)}"` });
  };
  const addTile = (title, iconName) => {
    const p = pendingByTitle.get(normalizeTitle(title));
    if (p) return pendingTile(p);
    return tile({ title, iconName, attrs: `data-tile-add="${esc(title)}" data-tile-icon="${esc(iconName)}" aria-label="Añadir ${esc(title)}"` });
  };

  let html = `
    <div class="list-head">
      <div>
        <div class="muted text-sm">${esc(fmtLongDate(new Date()))}</div>
        <h2 class="list-head__title">${pending.length ? `${pending.length} pendiente${pending.length === 1 ? '' : 's'}` : 'Todo al día'}</h2>
      </div>
      ${doneToday.length ? `<button class="btn btn--ghost btn--sm" id="toggle-done">${icon('check-circle')}${doneToday.length} hoy</button>` : ''}
    </div>
    <form class="search-add" id="search-add" autocomplete="off">
      ${icon('plus')}
      <input class="input" id="search-input" placeholder="¿Qué hay que hacer?" maxlength="80" enterkeyhint="done" value="${esc(state.search || '')}">
    </form>
    <div id="search-results"></div>
    <div id="main-tiles">`;

  if (pending.length) {
    html += `<div class="tiles tiles--pending">${pending.map(pendingTile).join('')}</div>
      <p class="help center tiles-hint">Toca para resolver · Mantén pulsado para editar</p>`;
  } else {
    html += `<div class="card empty"><span class="empty__emoji">${icon('sparkles')}</span>No hay nada pendiente para hoy.<div class="muted text-sm" style="margin-top:6px">Toca una tarea de abajo para añadirla.</div></div>`;
  }
  if (upcomingCount) html += `<button class="btn btn--ghost btn--block btn--sm" data-goto="proximas" style="margin-bottom:10px">${icon('calendar')}${upcomingCount} planificada${upcomingCount === 1 ? '' : 's'} para otros días</button>`;

  if (state.showDoneToday && doneToday.length) {
    html += `<div class="section-title"><h2>Resueltas hoy</h2></div>` + todoList(doneToday, memById);
  }
  if (recent.length) {
    html += `<div class="section-title"><h2>Recientes</h2></div><div class="tiles">${recent.map((t) => addTile(t.title, t.icon)).join('')}</div>`;
  }
  for (const cat of CATALOG) {
    html += `<div class="section-title"><h2>${esc(cat.name)}</h2></div><div class="tiles">${cat.items.map((it) => addTile(it.name, it.icon)).join('')}</div>`;
  }
  html += `</div>` + fab('Nueva tarea con fecha');
  view().innerHTML = html;

  wireTiles(all);
  wireTodoRows(all);
  $$('[data-goto]').forEach((b) => b.onclick = () => setView(b.dataset.goto));
  $('#fab-add').onclick = () => openTodoModal({ dueDate: today, title: $('#search-input').value.trim() });
  const tg = $('#toggle-done');
  if (tg) tg.onclick = () => { state.showDoneToday = !state.showDoneToday; renderHoy(); };

  // Buscador: filtra el catálogo y permite crear una tarea con lo escrito.
  const input = $('#search-input');
  const renderResults = () => {
    const q = input.value.trim();
    state.search = q;
    $('#main-tiles').classList.toggle('hidden', !!q);
    if (!q) { $('#search-results').innerHTML = ''; return; }
    const matches = searchCatalog(q).slice(0, 12);
    const exact = matches.some((m) => normalizeTitle(m.name) === normalizeTitle(q)) || pendingByTitle.has(normalizeTitle(q));
    $('#search-results').innerHTML = `<div class="tiles">
      ${exact ? '' : tile({ title: q, iconName: guessIcon(q), cls: 'tile--new', attrs: `data-tile-add="${esc(q)}" data-tile-icon="${esc(guessIcon(q))}"` })}
      ${matches.map((m) => addTile(m.name, m.icon)).join('')}
    </div><p class="help center">Toca para añadirla a hoy · El botón <b>+</b> de abajo permite elegir fecha</p>`;
    wireTiles(all);
  };
  input.oninput = renderResults;
  $('#search-add').onsubmit = async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const p = pendingByTitle.get(normalizeTitle(q));
    if (p) { toast('Ya está pendiente'); return; }
    const hit = searchCatalog(q).find((m) => normalizeTitle(m.name) === normalizeTitle(q));
    await addForToday(q, hit ? hit.icon : guessIcon(q));
  };
  if (state.search) { renderResults(); input.focus(); }
}

async function addForToday(title, iconName) {
  const todo = await db.addTodo({ title, icon: iconName, dueDate: todayKey(), createdBy: state.settings.currentMemberId });
  state.search = '';
  scheduleAutoSync(); notifyCreated(todo);
  toast(`Añadida: ${title}`, 'ok', { action: { label: 'Deshacer', fn: async () => { await db.deleteTodo(todo.id); scheduleAutoSync(); refresh(); } } });
  await renderHoy();
}

/* Toque = acción principal; pulsación larga (o clic derecho) = editar. */
function wireTiles(all) {
  const LONG_MS = 450;
  $$('[data-tile-todo], [data-tile-add]').forEach((el) => {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    let timer = null, longFired = false;
    const edit = () => {
      const t = all.find((x) => x.id === el.dataset.tileTodo);
      if (t) openTodoModal({ todo: t });
      else openTodoModal({ title: el.dataset.tileAdd, icon: el.dataset.tileIcon });
    };
    el.addEventListener('pointerdown', () => {
      longFired = false;
      timer = setTimeout(() => { longFired = true; navigator.vibrate?.(15); edit(); }, LONG_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => el.addEventListener(ev, () => clearTimeout(timer)));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(timer); if (!longFired) edit(); longFired = true; });
    el.addEventListener('click', () => {
      if (longFired) { longFired = false; return; }
      if (el.dataset.tileTodo) completeTodo(el.dataset.tileTodo);
      else addForToday(el.dataset.tileAdd, el.dataset.tileIcon);
    });
  });
}

/* ========================== Vista: PRÓXIMAS ============================= */
async function renderProximas() {
  const [members, all] = await Promise.all([db.members(), db.todos()]);
  const memById = new Map(members.map((m) => [m.id, m]));
  const today = todayKey();
  const upcoming = all.filter((t) => !t.done && t.dueDate > today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt - b.createdAt);

  let html = '';
  if (!upcoming.length) {
    html += emptyCard('calendar', 'No hay nada planificado.<div class="muted text-sm" style="margin-top:6px">Pulsa <b>+</b> para programar una tarea para otro día.</div>');
  } else {
    const byDay = new Map();
    for (const t of upcoming) { if (!byDay.has(t.dueDate)) byDay.set(t.dueDate, []); byDay.get(t.dueDate).push(t); }
    for (const [day, items] of byDay) {
      const d = parseYmd(day);
      const label = day === addDays(today, 1) ? `Mañana · ${fmtShortDay(d)}` : fmtLongDate(d);
      html += `<div class="section-title"><h2>${esc(label)}</h2></div>` + todoList(items, memById, { hideDate: true });
    }
  }
  html += fab('Planificar tarea');
  view().innerHTML = html;
  wireTodoRows(all);
  $('#fab-add').onclick = () => openTodoModal({ dueDate: addDays(today, 1) });
}

/* =========================== Vista: HECHAS ============================== */
async function renderHechas() {
  const [members, all] = await Promise.all([db.members(), db.todos()]);
  const memById = new Map(members.map((m) => [m.id, m]));
  const done = all.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt).slice(0, 150);
  const weekStart = startOfWeek(new Date()).getTime();
  const perMember = new Map();
  for (const t of done) if (t.doneAt >= weekStart && t.doneBy) perMember.set(t.doneBy, (perMember.get(t.doneBy) || 0) + 1);

  let html = '';
  if (perMember.size) {
    html += `<div class="card"><div class="muted text-sm" style="margin-bottom:10px">Resueltas esta semana</div><div class="chips">`
      + [...perMember].sort((a, b) => b[1] - a[1]).map(([id, n]) => {
        const m = memById.get(id) || { name: '?', color: '#888' };
        return `<span class="chip">${avatar(m, 'xs')}${esc(m.name)} <b>${n}</b></span>`;
      }).join('') + `</div></div>`;
  }
  if (!done.length) {
    html += emptyCard('check-circle', 'Aquí aparecerán las tareas resueltas.');
  } else {
    const byDay = new Map();
    for (const t of done) { const k = ymd(new Date(t.doneAt)); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(t); }
    for (const [day, items] of byDay) {
      const d = parseYmd(day);
      const label = day === todayKey() ? 'Hoy' : day === addDays(todayKey(), -1) ? 'Ayer' : fmtLongDate(d);
      html += `<div class="section-title"><h2>${esc(label)}</h2></div>` + todoList(items, memById);
    }
  }
  view().innerHTML = html;
  wireTodoRows(all);
}

/* ======================= Modal: crear / editar tarea ==================== */
async function openTodoModal({ todo = null, dueDate = todayKey(), title = '', icon: iconName = '' } = {}) {
  const members = await db.members();
  const today = todayKey(), tomorrow = addDays(today, 1);
  const cur = todo ? { ...todo } : { title, icon: iconName || (title ? guessIcon(title) : 'sparkles'), dueDate, repeat: 'none', assignee: null, note: '' };
  let iconTouched = !!todo || !!iconName;
  const whenMode = cur.dueDate === today ? 'today' : cur.dueDate === tomorrow ? 'tomorrow' : 'date';

  openModal(todo ? 'Editar tarea' : 'Nueva tarea', `
    <div class="field"><label>¿Qué hay que hacer?</label>
      <input class="input" id="td-title" placeholder="Ej: Sacar la basura" maxlength="80" value="${esc(cur.title)}">
    </div>
    <div class="field"><label>¿Cuándo?</label>
      <div class="segment segment--block" id="td-when">
        <button type="button" data-when="today" class="${whenMode === 'today' ? 'is-active' : ''}">Hoy</button>
        <button type="button" data-when="tomorrow" class="${whenMode === 'tomorrow' ? 'is-active' : ''}">Mañana</button>
        <button type="button" data-when="date" class="${whenMode === 'date' ? 'is-active' : ''}">Otro día</button>
      </div>
      <input class="input ${whenMode === 'date' ? '' : 'hidden'}" type="date" id="td-date" value="${esc(cur.dueDate)}" style="margin-top:8px">
    </div>
    <div class="field"><label>Repetir</label>
      <select class="select" id="td-repeat">
        ${Object.entries(REPEATS).map(([k, l]) => `<option value="${k}" ${k === cur.repeat ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>¿A quién le toca?</label>
      <div class="person-picker" id="td-who">
        <button type="button" class="person-pick ${!cur.assignee ? 'is-active' : ''}" data-mid="">${icon('users')}Cualquiera</button>
        ${members.map((m) => `<button type="button" class="person-pick ${m.id === cur.assignee ? 'is-active' : ''}" data-mid="${esc(m.id)}">${avatar(m)}${esc(m.name)}</button>`).join('')}
      </div>
    </div>
    <div class="field"><label>Icono</label>
      <div class="icon-grid" id="td-icon">
        ${TASK_ICONS.map((k) => `<button type="button" class="${k === cur.icon ? 'is-active' : ''}" data-icon-pick="${k}" aria-label="${k}">${icon(k)}</button>`).join('')}
      </div>
    </div>
    <div class="field"><label>Nota (opcional)</label>
      <input class="input" id="td-note" placeholder="Ej: la de reciclaje también" maxlength="120" value="${esc(cur.note)}">
    </div>
    <div class="modal__actions">
      ${todo ? `<button class="btn btn--danger" id="td-delete">${icon('trash')}Eliminar</button>` : ''}
      <button class="btn btn--primary" id="td-save">${todo ? 'Guardar' : 'Añadir'}</button>
    </div>`, {
    onMount(modal) {
      const dateInput = $('#td-date', modal);
      $$('[data-when]', modal).forEach((b) => b.onclick = () => {
        $$('[data-when]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
        const w = b.dataset.when;
        dateInput.classList.toggle('hidden', w !== 'date');
        if (w === 'today') dateInput.value = today;
        else if (w === 'tomorrow') dateInput.value = tomorrow;
        else { if (dateInput.value <= tomorrow) dateInput.value = addDays(today, 2); dateInput.focus(); }
      });
      $$('[data-mid]', modal).forEach((b) => b.onclick = () => {
        cur.assignee = b.dataset.mid || null;
        $$('[data-mid]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
      });
      $$('[data-icon-pick]', modal).forEach((b) => b.onclick = () => {
        cur.icon = b.dataset.iconPick; iconTouched = true;
        $$('[data-icon-pick]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
      });
      if (!todo && !title) $('#td-title', modal).focus();
      // Mientras no se elija icono a mano, se sugiere según el título.
      $('#td-title', modal).oninput = (e) => {
        if (iconTouched) return;
        cur.icon = guessIcon(e.target.value);
        $$('[data-icon-pick]', modal).forEach((x) => x.classList.toggle('is-active', x.dataset.iconPick === cur.icon));
      };

      $('#td-save', modal).onclick = async () => {
        const title = $('#td-title', modal).value.trim();
        if (!title) return toast('Escribe qué hay que hacer', 'err');
        const due = dateInput.value || today;
        const fields = { title, icon: cur.icon, dueDate: due, repeat: $('#td-repeat', modal).value, assignee: cur.assignee, note: $('#td-note', modal).value.trim() };
        if (todo) {
          await db.updateTodo(todo.id, fields);
          closeModal(); toast('Tarea guardada', 'ok');
        } else {
          const created = await db.addTodo({ ...fields, createdBy: state.settings.currentMemberId });
          notifyCreated(created);
          state.search = '';
          closeModal(); toast(due === today ? 'Añadida para hoy' : `Planificada: ${dueLabel(due)}`, 'ok');
        }
        scheduleAutoSync(); await refresh();
      };
      const del = $('#td-delete', modal);
      if (del) del.onclick = async () => {
        if (!await confirmDialog(`¿Eliminar «${todo.title}»? Se borrará para todo el grupo.`, { danger: true, okText: 'Eliminar' })) return;
        await db.deleteTodo(todo.id);
        toast('Tarea eliminada', 'ok'); scheduleAutoSync(); await refresh();
      };
    }
  });
}

/* ======================= Inicio: crear o unirse a un grupo =============== */
let pendingInvite = null; // Invitación recibida por enlace, para rellenar el formulario.

function nextColor(used) {
  return MEMBER_COLORS.find((c) => !used.includes(c)) || MEMBER_COLORS[used.length % MEMBER_COLORS.length];
}

function renderOnboarding() {
  const s = state.settings;
  const mode = pendingInvite ? 'join' : (state.onboardMode || 'create');
  view().innerHTML = `
    <div class="onboard">
      <div class="onboard__logo">${icon('home')}</div>
      <h1>Tareas del Hogar</h1>
      <p class="muted">Comparte con tu pareja o familia las tareas pendientes de hoy y las que estén por venir.</p>

      <div class="segment segment--block" style="margin:22px 0 16px">
        <button data-mode="create" class="${mode === 'create' ? 'is-active' : ''}">Crear grupo</button>
        <button data-mode="join" class="${mode === 'join' ? 'is-active' : ''}">Unirme a un grupo</button>
      </div>

      <div class="card">
        ${mode === 'create' ? `
          <div class="field"><label>Nombre del grupo</label>
            <input class="input" id="ob-group" value="${esc(DEFAULT_GROUP)}" maxlength="40">
          </div>
          <div class="field"><label>Tu nombre</label>
            <input class="input" id="ob-name" placeholder="Ej: Juan" maxlength="30" autocomplete="given-name">
            <p class="help">Así te verán los demás miembros del grupo.</p>
          </div>
          <button class="btn btn--primary btn--block" id="ob-create">Crear grupo</button>
          <p class="help" style="margin-top:12px">Después, en la pestaña <b>Grupo</b>, conectas Google Sheets, activas los avisos e invitas a tu pareja.</p>
        ` : `
          ${pendingInvite ? `<div class="invite-box">${icon('link')}<div>Invitación al grupo <b>${esc(pendingInvite.groupName || DEFAULT_GROUP)}</b></div></div>` : `
          <div class="field"><label>Invitación</label>
            <input class="input" id="ob-code" placeholder="Pega aquí el enlace o el código" autocapitalize="off" autocomplete="off" spellcheck="false">
            <p class="help">Pídesela a quien creó el grupo: Grupo → Invitar.</p>
          </div>`}
          <div class="field"><label>Tu nombre</label>
            <input class="input" id="ob-name" placeholder="Ej: Ana" maxlength="30" autocomplete="given-name">
          </div>
          <button class="btn btn--primary btn--block" id="ob-join">Unirme</button>
        `}
      </div>
    </div>`;

  $$('[data-mode]').forEach((b) => b.onclick = () => { state.onboardMode = b.dataset.mode; if (b.dataset.mode === 'create') pendingInvite = null; renderOnboarding(); });

  const createBtn = $('#ob-create');
  if (createBtn) createBtn.onclick = async () => {
    const groupName = $('#ob-group').value.trim() || DEFAULT_GROUP;
    const name = $('#ob-name').value.trim();
    if (!name) return toast('Escribe tu nombre', 'err');
    const used = (await db.members()).map((m) => m.color);
    const me = await db.addMember({ name, color: nextColor(used) });
    state.settings = await db.saveSettings({
      groupName, currentMemberId: me.id,
      // Si venía de la v1.1 con algo configurado, se conserva.
      ntfyTopic: isValidTopic(s.ntfyTopic) ? s.ntfyTopic : randomTopic(groupName),
      notifyEnabled: true
    });
    toast(`Grupo «${groupName}» creado`, 'ok');
    scheduleAutoSync();
    await setView('grupo');
  };

  const joinBtn = $('#ob-join');
  if (joinBtn) joinBtn.onclick = async () => {
    const name = $('#ob-name').value.trim();
    let invite = pendingInvite;
    if (!invite) {
      invite = parseInvite($('#ob-code').value.trim());
      if (!invite) return toast('La invitación no es válida', 'err');
    }
    if (!name) return toast('Escribe tu nombre', 'err');
    await joinGroup(invite, name);
  };
}

async function joinGroup(invite, name) {
  state.settings = await db.saveSettings({
    groupName: invite.groupName || DEFAULT_GROUP,
    syncUrl: invite.syncUrl || '', syncSecret: invite.syncSecret || '', autoSync: true,
    ntfyServer: invite.ntfyServer || 'https://ntfy.sh', ntfyTopic: isValidTopic(invite.ntfyTopic) ? invite.ntfyTopic : '',
    notifyEnabled: isValidTopic(invite.ntfyTopic)
  });
  // Primero traemos el grupo para elegir un color libre y no duplicar nombre.
  if (state.settings.syncUrl) { try { await syncNow(); } catch (e) { console.warn(e); } }
  const existing = await db.members();
  const same = existing.find((m) => m.name.trim().toLowerCase() === name.toLowerCase());
  const me = same || await db.addMember({ name, color: nextColor(existing.map((m) => m.color)) });
  state.settings = await db.saveSettings({ currentMemberId: me.id });
  pendingInvite = null;
  toast(`Te has unido a «${state.settings.groupName}»`, 'ok');
  await setView('hoy');
  if (state.settings.syncUrl) doSync(true);
  else toast('La invitación no trae Google Sheets: no se compartirán las tareas', 'err');
}

/* ----------------------------- Invitaciones ----------------------------- */
/* La invitación viaja en el hash de la URL (#join=...), que el navegador
 * nunca envía al servidor. Contiene el nombre del grupo, la URL de sync, la
 * clave y el tema de ntfy: compártela solo por un canal privado. */
function encodeInvite(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function parseInvite(raw) {
  if (!raw) return null;
  try {
    const m = raw.match(/#(?:join|setup)=([-_A-Za-z0-9]+)/);
    const b64 = (m ? m[1] : raw).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const cfg = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    // v1 = "Compartir configuración" de la 1.1 (sin nombre de grupo).
    if (!cfg || (cfg.v !== 1 && cfg.v !== 2)) return null;
    return cfg;
  } catch { return null; }
}
function inviteUrl() {
  const s = state.settings;
  const code = encodeInvite({ v: 2, groupName: s.groupName, syncUrl: s.syncUrl, syncSecret: s.syncSecret, ntfyServer: s.ntfyServer, ntfyTopic: s.ntfyTopic });
  return `${location.origin}${location.pathname}#join=${code}`;
}
async function shareInvite() {
  const s = state.settings;
  if (!s.syncUrl && !await confirmDialog('Aún no has conectado Google Sheets: sin eso la otra persona no verá vuestras tareas. ¿Enviar la invitación igualmente?', { okText: 'Enviar' })) return;
  const url = inviteUrl();
  const text = `Únete a «${s.groupName}» en Tareas del Hogar. Abre el enlace o pégalo en la app (Unirme a un grupo):`;
  if (navigator.share) {
    try { await navigator.share({ title: s.groupName, text, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Invitación copiada: envíasela a tu pareja', 'ok'); }
  catch { prompt('Copia esta invitación y envíasela:', url); }
}
/* Si la app se abre con un enlace de invitación, lo usamos. */
async function checkInviteLink() {
  if (!/^#(join|setup)=/.test(location.hash)) return;
  const invite = parseInvite(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  if (!invite) return toast('La invitación no es válida', 'err');
  if (!hasGroup()) { pendingInvite = invite; return refresh(); }
  const s = state.settings;
  if ((invite.syncUrl && invite.syncUrl === s.syncUrl) || (invite.ntfyTopic && invite.ntfyTopic === s.ntfyTopic)) {
    return toast(`Ya estás en «${s.groupName}»`);
  }
  if (await confirmDialog(`¿Salir de «${s.groupName}» y unirte a «${invite.groupName || DEFAULT_GROUP}»? Se borrarán de este móvil las tareas del grupo actual.`, { danger: true, okText: 'Cambiar de grupo' })) {
    await leaveGroup(false);
    pendingInvite = invite;
    await refresh();
  }
}

async function leaveGroup(confirmFirst = true) {
  if (confirmFirst && !await confirmDialog(`¿Salir de «${state.settings.groupName}»? Se borrarán de este móvil las tareas y la configuración del grupo. Si usáis Google Sheets, los demás las conservan.`, { danger: true, okText: 'Salir del grupo' })) return;
  // Avisamos al resto de que ya no estamos (si hay sync).
  if (state.settings.currentMemberId) {
    await db.deleteMember(state.settings.currentMemberId);
    if (state.settings.syncUrl) { try { await syncNow(); } catch (e) { console.warn(e); } }
  }
  for (const s of db.DATA_STORES) await db.clearStore(s);
  state.settings = await db.saveSettings({
    groupName: '', currentMemberId: null, syncUrl: '', syncSecret: '', lastSyncAt: 0,
    notifyEnabled: false, ntfyTopic: ''
  });
  state.view = 'hoy';
  await refresh();
}

/* ============================ Vista: GRUPO ============================== */
async function renderGrupo() {
  const s = state.settings;
  const members = (await db.members()).sort((a, b) => (a.id === s.currentMemberId ? -1 : b.id === s.currentMemberId ? 1 : a.name.localeCompare(b.name)));
  const lastSync = s.lastSyncAt ? `${relativeDay(s.lastSyncAt)} ${fmtTime(s.lastSyncAt)}` : 'Nunca';
  const notifyOn = s.notifyEnabled && isValidTopic(s.ntfyTopic);

  view().innerHTML = `
    <div class="card group-head">
      <div class="group-head__logo">${icon('users')}</div>
      <div class="list-item__body">
        <div class="group-head__name">${esc(s.groupName)}</div>
        <div class="muted text-sm">${members.length} miembro${members.length === 1 ? '' : 's'}</div>
      </div>
      <button class="icon-btn" id="btn-rename" aria-label="Cambiar nombre del grupo">${icon('edit')}</button>
    </div>

    <!-- Miembros -->
    <div class="section-title"><h2>Miembros</h2></div>
    <div class="card card--pad0"><div class="list">
      ${members.map((m) => `
        <div class="list-item">
          ${avatar(m, 'lg')}
          <div class="list-item__body"><div class="list-item__title">${esc(m.name)}</div>
            ${m.id === s.currentMemberId ? '<div class="list-item__sub">Tú, en este móvil</div>' : ''}</div>
          ${m.id === s.currentMemberId
            ? `<button class="delete-x" id="btn-me-edit" aria-label="Cambiar tu nombre">${icon('edit')}</button>`
            : `<button class="delete-x" data-del-member="${esc(m.id)}" aria-label="Quitar del grupo">${icon('x')}</button>`}
        </div>`).join('')}
    </div></div>
    <button class="btn btn--primary btn--block" id="btn-invite" style="margin-bottom:6px">${icon('share')}Invitar a alguien</button>
    <p class="help" style="margin-bottom:22px">Envía la invitación a tu pareja por WhatsApp o similar. Al abrirla, escribirá su nombre y aparecerá aquí.</p>

    <!-- Sincronización -->
    <div class="section-title"><h2>Compartir tareas (Google Sheets)</h2></div>
    <div class="card">
      <div class="sync-status" style="margin-bottom:12px">
        <span class="sync-dot ${s.syncUrl ? 'sync-dot--ok' : 'sync-dot--off'}"></span>
        <span>${s.syncUrl ? 'Conectado' : 'Sin conectar: las tareas solo están en este móvil'}${s.syncUrl ? ' · Última: ' + esc(lastSync) : ''}</span>
      </div>
      <div class="field"><label>URL del Web App (Google Apps Script)</label>
        <input class="input" id="set-url" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(s.syncUrl)}" autocapitalize="off" spellcheck="false">
      </div>
      <div class="field"><label>Clave secreta (opcional)</label>
        <input class="input" id="set-secret" placeholder="Debe coincidir con SECRET del script" value="${esc(s.syncSecret)}" autocapitalize="off" spellcheck="false">
      </div>
      <div class="field">
        <label class="flex-between" style="cursor:pointer">
          <span>Sincronizar automáticamente</span>
          <input type="checkbox" id="set-autosync" ${s.autoSync ? 'checked' : ''} class="switch">
        </label>
      </div>
      <div class="row" style="margin-bottom:10px">
        <button class="btn" id="btn-test">Probar</button>
        <button class="btn btn--primary" id="btn-savesync">Guardar</button>
      </div>
      <button class="btn btn--ghost btn--block btn--sm" id="btn-guide">${icon('book')}Cómo configurar Google Sheets</button>
    </div>

    <!-- Notificaciones -->
    <div class="section-title"><h2>Avisos al móvil (ntfy)</h2></div>
    <div class="card">
      <div class="sync-status" style="margin-bottom:12px">
        <span class="sync-dot ${notifyOn ? 'sync-dot--ok' : 'sync-dot--off'}"></span>
        <span>${notifyOn ? 'Activos' : 'Desactivados'}</span>
      </div>
      <div class="field">
        <label class="flex-between" style="cursor:pointer">
          <span>Avisar al añadir o resolver tareas</span>
          <input type="checkbox" id="set-notify" ${s.notifyEnabled ? 'checked' : ''} class="switch">
        </label>
      </div>
      <div class="field"><label>Tema de ntfy</label>
        <div class="input-group">
          <input class="input" id="set-topic" placeholder="tareas-hogar-xxxx" value="${esc(s.ntfyTopic)}" autocapitalize="off" autocomplete="off" spellcheck="false">
          <button class="btn" id="btn-topic-gen" title="Generar tema aleatorio" aria-label="Generar tema aleatorio">${icon('key')}</button>
        </div>
        <p class="help">Va incluido en la invitación. Quien conozca el tema puede leer los avisos: no lo publiques.</p>
      </div>
      <div class="field"><label>Servidor ntfy</label>
        <input class="input" id="set-ntfy-server" placeholder="https://ntfy.sh" value="${esc(s.ntfyServer)}" autocapitalize="off" spellcheck="false">
      </div>
      <div class="row" style="margin-bottom:10px">
        <button class="btn" id="btn-notify-test">${icon('send')}Probar</button>
        <button class="btn btn--primary" id="btn-notify-save">Guardar</button>
      </div>
      <button class="btn btn--ghost btn--block btn--sm" id="btn-notify-guide">${icon('bell')}Cómo recibirlos en el móvil</button>
    </div>

    <button class="btn btn--danger btn--block" id="btn-leave" style="margin-top:8px">${icon('logout')}Salir del grupo</button>
  `;

  // --- Grupo y miembros ---
  $('#btn-rename').onclick = () => promptText('Nombre del grupo', s.groupName, 40, async (v) => {
    state.settings = await db.saveSettings({ groupName: v });
    toast('Nombre cambiado. Reenvía la invitación si quieres que lo vean igual.', 'ok');
    await refresh();
  });
  const meEdit = $('#btn-me-edit');
  if (meEdit) meEdit.onclick = async () => {
    const me = await db.getOne('members', s.currentMemberId);
    promptText('Tu nombre', me ? me.name : '', 30, async (v) => {
      await db.updateMember(s.currentMemberId, { name: v });
      scheduleAutoSync(); await renderGrupo();
    });
  };
  $$('[data-del-member]').forEach((b) => b.onclick = async () => {
    const m = members.find((x) => x.id === b.dataset.delMember);
    if (await confirmDialog(`¿Quitar a ${m.name} del grupo? Sus tareas resueltas se conservan.`, { danger: true, okText: 'Quitar' })) {
      await db.deleteMember(m.id); scheduleAutoSync(); await renderGrupo();
    }
  });
  $('#btn-invite').onclick = shareInvite;
  $('#btn-leave').onclick = () => leaveGroup(true);

  // --- Sincronización ---
  $('#btn-test').onclick = async () => {
    const url = $('#set-url').value.trim();
    if (!url) return toast('Introduce la URL', 'err');
    toast('Probando…');
    try { const r = await testConnection(url, $('#set-secret').value.trim()); toast(`Conexión correcta · ${r.count} registros`, 'ok'); }
    catch (e) { toast('Error: ' + e.message, 'err'); }
  };
  $('#btn-savesync').onclick = async () => {
    state.settings = await db.saveSettings({
      syncUrl: $('#set-url').value.trim(),
      syncSecret: $('#set-secret').value.trim(),
      autoSync: $('#set-autosync').checked
    });
    await renderGrupo();
    if (state.settings.syncUrl) await doSync(false);
  };
  $('#set-autosync').onchange = async (e) => { state.settings = await db.saveSettings({ autoSync: e.target.checked }); };
  $('#btn-guide').onclick = openGuideModal;

  // --- Notificaciones ---
  const readNotifyForm = () => ({
    notifyEnabled: $('#set-notify').checked,
    ntfyTopic: $('#set-topic').value.trim(),
    ntfyServer: $('#set-ntfy-server').value.trim() || 'https://ntfy.sh'
  });
  $('#btn-topic-gen').onclick = async () => {
    if ($('#set-topic').value.trim() && !await confirmDialog('Si cambias el tema, todos tendréis que suscribiros de nuevo en ntfy (y reenviar la invitación). ¿Generar uno nuevo?', { okText: 'Generar' })) return;
    $('#set-topic').value = randomTopic(s.groupName);
  };
  $('#btn-notify-save').onclick = async () => {
    const f = readNotifyForm();
    if (f.notifyEnabled && !isValidTopic(f.ntfyTopic)) return toast('El tema no es válido', 'err');
    state.settings = await db.saveSettings(f);
    toast('Avisos guardados', 'ok');
    await renderGrupo();
  };
  $('#btn-notify-test').onclick = async () => {
    const f = readNotifyForm();
    if (!isValidTopic(f.ntfyTopic)) return toast('Escribe o genera un tema', 'err');
    try { await testNotify(f.ntfyServer, f.ntfyTopic, s.groupName); toast('Aviso de prueba enviado', 'ok'); }
    catch (e) { toast('Error: ' + e.message, 'err'); }
  };
  $('#btn-notify-guide').onclick = () => openNotifyGuideModal(readNotifyForm());
}

/** Pequeño diálogo para pedir un texto. */
function promptText(title, value, maxlength, onSave) {
  openModal(title, `
    <div class="field"><input class="input" id="pt-input" value="${esc(value)}" maxlength="${maxlength}"></div>
    <div class="modal__actions"><button class="btn btn--primary btn--block" id="pt-save">Guardar</button></div>`, {
    onMount(modal) {
      const input = $('#pt-input', modal);
      input.focus(); input.select();
      const save = async () => {
        const v = input.value.trim();
        if (!v) return toast('No puede quedar vacío', 'err');
        closeModal(); await onSave(v);
      };
      $('#pt-save', modal).onclick = save;
      input.onkeydown = (e) => { if (e.key === 'Enter') save(); };
    }
  });
}

/* ============================ Vista: AJUSTES ============================ */
async function renderAjustes() {
  const s = state.settings;
  const persist = await navigator.storage?.persisted?.().catch(() => false);
  const est = await db.storageEstimate();
  const usage = est ? `${(est.usage / 1024).toFixed(0)} KB usados` : '';

  view().innerHTML = `
    <!-- Apariencia -->
    <div class="section-title"><h2>Apariencia</h2></div>
    <div class="card">
      <div class="field"><label>Tema</label>
        <div class="segment segment--block" id="set-theme">
          <button data-theme-btn="dark" class="${s.theme === 'dark' ? 'is-active' : ''}">${icon('moon')}Oscuro</button>
          <button data-theme-btn="light" class="${s.theme === 'light' ? 'is-active' : ''}">${icon('sun')}Claro</button>
        </div>
      </div>
      <div class="field mb-0"><label>Color de acento</label>
        <div class="color-grid" id="set-accent">
          ${ACCENTS.map((c) => `<button type="button" class="color-swatch ${c === s.accent ? 'is-active' : ''}" style="background:${c}" data-accent="${c}" aria-label="Color ${c}"></button>`).join('')}
        </div>
      </div>
    </div>

    <!-- Almacenamiento -->
    <div class="section-title"><h2>Almacenamiento</h2></div>
    <div class="card">
      <div class="sync-status" style="margin-bottom:${persist ? '0' : '12px'}">
        <span class="sync-dot ${persist ? 'sync-dot--ok' : 'sync-dot--off'}"></span>
        <span>${persist ? 'Almacenamiento persistente activo' : 'Almacenamiento no persistente'} ${usage ? '· ' + usage : ''}</span>
      </div>
      ${persist ? '' : `<button class="btn btn--block btn--sm" id="btn-persist">Activar almacenamiento persistente</button>
        <p class="help">Instalar la app en la pantalla de inicio ayuda a que el navegador lo conceda.</p>`}
    </div>

    <!-- Datos -->
    <div class="section-title"><h2>Copia de seguridad</h2></div>
    <div class="card">
      <div class="row">
        <button class="btn btn--sm" id="btn-export">${icon('download')}Exportar</button>
        <button class="btn btn--sm" id="btn-import">${icon('upload')}Importar</button>
      </div>
      <input type="file" id="file-import" accept="application/json" class="hidden">
    </div>

    <!-- Acerca de -->
    <div class="section-title"><h2>Acerca de</h2></div>
    <div class="card flex-between">
      <div><div class="list-item__title">Tareas del Hogar</div><div class="muted text-sm">Versión ${APP_VERSION}</div></div>
      <button class="btn btn--sm" id="btn-changelog">Novedades</button>
    </div>
    <p class="help center" style="margin-top:16px">Hecho con ${icon('heart')} · Datos guardados en tu dispositivo (IndexedDB).</p>
  `;

  $$('[data-theme-btn]').forEach((b) => b.onclick = async () => {
    state.settings = await db.saveSettings({ theme: b.dataset.themeBtn });
    applyAppearance(); await renderAjustes();
  });
  $$('[data-accent]').forEach((b) => b.onclick = async () => {
    state.settings = await db.saveSettings({ accent: b.dataset.accent });
    applyAppearance(); await renderAjustes();
  });
  const persistBtn = $('#btn-persist');
  if (persistBtn) persistBtn.onclick = async () => {
    const r = await db.requestPersistentStorage();
    toast(r.persisted ? 'Persistencia activada' : 'El navegador no la concedió', r.persisted ? 'ok' : 'err');
    await renderAjustes();
  };
  $('#btn-export').onclick = exportData;
  $('#btn-import').onclick = () => $('#file-import').click();
  $('#file-import').onchange = importData;
  $('#btn-changelog').onclick = openChangelogModal;
}

/* ---------------------- Guía de Google Sheets --------------------------- */
function openGuideModal() {
  openModal('Configurar Google Sheets', `
    <ol style="padding-left:20px;line-height:1.6;font-size:14px">
      <li>Crea una <b>Google Sheet</b> nueva (hoja de cálculo en blanco).</li>
      <li>Menú <b>Extensiones → Apps Script</b>.</li>
      <li>Borra el contenido y <b>pega este código</b>:</li>
    </ol>
    <div style="position:relative;margin:10px 0">
      <pre style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;overflow:auto;max-height:220px;font-size:11px;line-height:1.4"><code id="gs-code"></code></pre>
      <button class="btn btn--sm" id="gs-copy" style="position:absolute;top:8px;right:8px">${icon('copy')}Copiar</button>
    </div>
    <ol start="4" style="padding-left:20px;line-height:1.6;font-size:14px">
      <li>Pulsa <b>Implementar → Nueva implementación</b>.</li>
      <li>Tipo: <b>Aplicación web</b>. Ejecutar como: <b>Yo</b>. Con acceso: <b>Cualquier persona</b>.</li>
      <li>Copia la <b>URL</b> que termina en <code>/exec</code>, pégala en Grupo → Compartir tareas y pulsa <b>Guardar</b>.</li>
      <li>Pulsa <b>Invitar a alguien</b>: la invitación ya lleva la URL, tu pareja no tiene que copiar nada.</li>
    </ol>
    <p class="help">La primera vez Google pedirá autorizar el script (es tuyo, es seguro). Si añades una <code>SECRET</code> en el código, ponla también en el campo "Clave secreta".</p>
    <div class="modal__actions"><button class="btn btn--primary btn--block" data-close>Entendido</button></div>
  `, {
    wide: true,
    onMount(modal) {
      $('#gs-code', modal).textContent = APPS_SCRIPT_CODE;
      $('#gs-copy', modal).onclick = async () => {
        try { await navigator.clipboard.writeText(APPS_SCRIPT_CODE); toast('Código copiado', 'ok'); }
        catch { toast('Copia manualmente', 'err'); }
      };
    }
  });
}

/* ------------------------ Guía de notificaciones ------------------------ */
function openNotifyGuideModal({ ntfyServer, ntfyTopic }) {
  const topic = isValidTopic(ntfyTopic) ? ntfyTopic : '';
  const customServer = ntfyServer && ntfyServer.replace(/\/+$/, '') !== 'https://ntfy.sh';
  openModal('Recibir avisos en el móvil', `
    <ol style="padding-left:20px;line-height:1.6;font-size:14px">
      <li>Instala la app gratuita <b>ntfy</b>:
        <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a> ·
        <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a>.</li>
      <li>En ntfy pulsa <b>+</b> (Suscribirse a un tema) y escribe este tema:</li>
    </ol>
    ${topic ? `<div class="input-group" style="margin:4px 0 12px">
        <input class="input" value="${esc(topic)}" readonly id="ng-topic">
        <button class="btn" id="ng-copy" aria-label="Copiar tema">${icon('copy')}</button>
      </div>` : `<p class="help" style="margin:4px 0 12px">Primero escribe o genera un tema y pulsa Guardar.</p>`}
    <ol start="3" style="padding-left:20px;line-height:1.6;font-size:14px">
      ${customServer ? `<li>Activa <b>Usar otro servidor</b> y escribe <code>${esc(ntfyServer)}</code>.</li>` : ''}
      <li>Si tu versión de ntfy lo permite, ponle como nombre visible <b>${esc(state.settings.groupName)}</b>.</li>
      <li>Tu pareja hace lo mismo en su móvil (el tema le llega con la invitación).</li>
      <li>Pulsa <b>Probar</b> para comprobarlo.</li>
    </ol>
    <p class="help">Recibiréis un aviso cada vez que alguien añada o resuelva una tarea. Si no hay conexión, el aviso se envía al recuperarla.</p>
    ${topic ? `<p class="help">También puedes verlos en el navegador: <a href="${esc(topicUrl(ntfyServer, topic))}" target="_blank" rel="noopener">${esc(topicUrl(ntfyServer, topic))}</a></p>` : ''}
    <div class="modal__actions"><button class="btn btn--primary btn--block" data-close>Entendido</button></div>
  `, {
    onMount(modal) {
      const copy = $('#ng-copy', modal);
      if (copy) copy.onclick = async () => {
        try { await navigator.clipboard.writeText(topic); toast('Tema copiado', 'ok'); }
        catch { $('#ng-topic', modal).select(); toast('Copia manualmente', 'err'); }
      };
    }
  });
}

/* ------------------------------- Changelog ------------------------------ */
/**
 * Registro de cambios. Con `since` (tras una actualización) destaca las
 * versiones posteriores a esa y pliega el resto del historial.
 */
function openChangelogModal({ since = '' } = {}) {
  const typeLabel = { add: ['add', 'Nuevo'], chg: ['chg', 'Mejora'], fix: ['fix', 'Arreglo'] };
  const isNew = (e) => since && compareVersions(e.version, since) > 0;
  const entry = (e) => `
    <div class="changelog-entry ${isNew(e) ? 'changelog-entry--new' : ''}">
      <div class="changelog-entry__head">
        <span class="changelog-entry__ver">v${esc(e.version)}</span>
        <span class="changelog-entry__date">${esc(e.date)}</span>
        ${e.version === APP_VERSION ? '<span class="changelog-new-tag">Actual</span>' : ''}
      </div>
      <ul>${e.changes.map((c) => {
        const [cls, lbl] = typeLabel[c.type] || ['chg', 'Cambio'];
        return `<li><span class="tag-type tag-type--${cls}">${lbl}</span> ${esc(c.text)}</li>`;
      }).join('')}</ul>
    </div>`;
  const fresh = CHANGELOG.filter(isNew);
  const html = fresh.length
    ? `<p class="changelog-intro">La app se ha actualizado a la versión ${esc(APP_VERSION)}. Esto es lo nuevo:</p>
       ${fresh.map(entry).join('')}
       <button class="btn btn--ghost btn--block btn--sm changelog-older" id="cl-older">${icon('history')}Ver todo el historial</button>
       <div id="cl-rest" class="hidden">${CHANGELOG.filter((e) => !isNew(e)).map(entry).join('')}</div>
       <div class="modal__actions"><button class="btn btn--primary btn--block" data-close>Entendido</button></div>`
    : CHANGELOG.map(entry).join('');
  openModal(fresh.length ? 'Novedades' : 'Registro de cambios', html, {
    onMount(modal) {
      const older = $('#cl-older', modal);
      if (older) older.onclick = () => { older.remove(); $('#cl-rest', modal).classList.remove('hidden'); };
    }
  });
}

/* Tras actualizar, enseña una vez las novedades. En una instalación nueva
 * solo se apunta la versión (no hay "novedades" para quien acaba de llegar). */
async function showWhatsNewIfUpdated() {
  const seen = state.settings.lastSeenVersion;
  if (seen === APP_VERSION) return;
  state.settings = await db.saveSettings({ lastSeenVersion: APP_VERSION });
  if (!seen || !hasGroup() || compareVersions(APP_VERSION, seen) <= 0) return;
  openChangelogModal({ since: seen });
}

/* ----------------------- Exportar / importar ---------------------------- */
async function exportData() {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tareas-hogar-backup-${ymd(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Copia exportada', 'ok');
}
async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    await db.importAll(payload, { merge: true });
    toast('Datos importados', 'ok');
    scheduleAutoSync();
    await refresh();
  } catch (err) { toast('Archivo no válido', 'err'); }
  e.target.value = '';
}

/* =============================== Arranque =============================== */
async function init() {
  await db.openDB();
  state.settings = await db.getSettings();
  applyAppearance();

  // Solicitar almacenamiento persistente de forma silenciosa. Algunos navegadores
  // solo la conceden tras interactuar con la página: reintentamos en el primer toque.
  db.requestPersistentStorage().catch(() => {});
  document.addEventListener('pointerdown', () => db.requestPersistentStorage().catch(() => {}), { once: true });

  // Iconos estáticos del shell (cabecera y barra inferior).
  $$('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

  // Cabecera
  $('#header-version').textContent = 'v' + APP_VERSION;
  $('#header-version').onclick = () => openChangelogModal();
  $('#btn-sync').onclick = () => doSync(false);

  // Navegación
  $$('.tabbar__item').forEach((b) => b.onclick = () => setView(b.dataset.view));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('hashchange', checkInviteLink);

  await setView('hoy');
  await checkInviteLink();
  if (!$('.modal-overlay')) await showWhatsNewIfUpdated();

  // Sincronización inicial y periódica en segundo plano (+ avisos pendientes).
  startBackgroundSync();

  // Service Worker
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register(new URL('sw.js', window.location.href)); }
    catch (err) { console.warn('SW no registrado:', err); }
  }
}

init();
