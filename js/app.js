/* Punto de entrada y orquestación de la interfaz. */
import * as db from './db.js';
import { syncNow, testConnection, checkSyncUrl } from './sync.js';
import { APP_VERSION, CHANGELOG, compareVersions } from './changelog.js';
import { icon, TASK_ICONS } from './icons.js';
import { notify, flushQueue, testNotify, randomTopic, isValidTopic, topicUrl } from './notify.js';
import { ymd, parseYmd, todayKey, addDays, nextDue, currentDue, isRepeating, normalizeRepeat, parseRepeat, repeatLabel, REPEAT_PRESETS, REPEAT_UNITS } from './dates.js';
import { searchItems, guessIcon, normalizeTitle } from './catalog.js';

/* =============================== Constantes ============================== */
const ACCENTS = ['#4f8cff', '#7c5cff', '#ff5c8a', '#ff7a45', '#f5b545', '#35c98b', '#22c3d6', '#8b5cf6', '#ef4444', '#14b8a6'];
const MEMBER_COLORS = ['#4f8cff', '#ff5c8a', '#35c98b', '#f5b545', '#7c5cff', '#ff7a45', '#22c3d6', '#ef4444'];
const DEFAULT_GROUP = 'Tareas Hogar';
const PERSONAL_GROUP = 'Mis tareas'; // Nombre propuesto para el grupo privado.

/* Código de Google Apps Script que el usuario debe pegar (copiar botón). */
const APPS_SCRIPT_CODE = `/**
 * Backend de sincronizacion para "Tareas".
 * Pegar en Extensiones > Apps Script, ejecutar doGet una vez para autorizarlo
 * y desplegar como Aplicacion web (Ejecutar como: Yo | Acceso: Cualquier usuario).
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
/** Configuración del grupo activo (o null si este móvil aún no tiene grupos). */
const G = () => db.activeGroup(state.settings);
function hasGroup() { return !!G(); }
/** Fecha que toca ahora a una tarea (ver currentDue: agrupa repeticiones perdidas). */
const dueOf = (t) => currentDue(t.dueDate, t.repeat);

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
  const g = G();
  document.body.classList.toggle('no-group', !g);
  document.body.classList.toggle('is-personal', !!(g && g.personal));
  $('#header-title').textContent = g ? g.name : 'Tareas';
  $('#group-switch').disabled = !g;
  $('#group-switch-icon').innerHTML = g ? icon(g.personal ? 'lock' : 'users') : '';
}

/* ============================ Sincronización ============================ */
const POLL_MS = 60 * 1000; // Con la app visible, traer cambios de los grupos cada minuto.
let autoSyncTimer = null;
let pollTimer = null;
const syncing = new Map(); // groupId → Promise de la sincronización en curso (evita solapes).

function scheduleAutoSync() {
  const g = G();
  if (!g || !g.autoSync || !g.syncUrl) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => doSync(true, g.id), 1500);
}
async function doSync(silent = false, groupId = G() && G().id) {
  const group = state.settings.groups.find((g) => g.id === groupId);
  if (!group || !group.syncUrl) {
    if (!silent) toast('Este grupo no tiene Google Sheets conectado (pestaña Grupo)', 'err');
    return;
  }
  if (syncing.has(groupId)) return syncing.get(groupId);
  const isActive = () => G() && G().id === groupId;
  const btn = $('#btn-sync');
  if (isActive()) btn.classList.add('is-spinning');
  const p = (async () => {
    try {
      const res = await syncNow(group);
      state.settings = await db.getSettings();
      if (!silent) toast(`Sincronizado (${res.pulled} recibidos)`, 'ok');
      // En segundo plano solo repintamos si llegó algo al grupo que se ve.
      if (isActive() && (!silent || res.pulled > 0)) await refreshKeepingScroll();
      return res;
    } catch (err) {
      if (!silent) toast('Error al sincronizar: ' + err.message, 'err');
      console.warn('Sync error', group.name, err);
    } finally {
      syncing.delete(groupId);
      if (![...syncing.keys()].some((id) => G() && id === G().id)) btn.classList.remove('is-spinning');
    }
  })();
  syncing.set(groupId, p);
  return p;
}
async function refreshKeepingScroll() {
  if ($('.modal-overlay')) return; // No repintar debajo de un formulario abierto.
  const a = document.activeElement;
  if (a && a.matches('input, textarea, select') && view().contains(a)) return; // Ni mientras se escribe.
  const y = window.scrollY;
  await refresh();
  window.scrollTo(0, y);
}

/* Sincroniza todos los grupos al abrir la app, al volver a ella, al
 * recuperar la red y periódicamente mientras está visible. */
function startBackgroundSync() {
  const tick = () => {
    flushQueue().catch(() => {});
    for (const g of state.settings.groups) if (g.syncUrl && g.autoSync) doSync(true, g.id);
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
  const g = G();
  const who = (await memberName(g.currentMemberId)) || 'Alguien';
  const forWhom = todo.assignee ? ` (le toca a ${(await memberName(todo.assignee)) || '?'})` : '';
  notify(g, { message: `${who} ha añadido «${todo.title}» ${dueForText(todo.dueDate)}${forWhom}`, tags: ['heavy_plus_sign'] });
}
async function notifyResolved(todo) {
  const g = G();
  const who = (await memberName(g.currentMemberId)) || 'Alguien';
  notify(g, { message: `${who} ha resuelto «${todo.title}»`, tags: ['white_check_mark'] });
}

/* ========================== Acciones sobre tareas ======================= */
async function completeTodo(id) {
  const { todo, next } = await db.completeTodo(id, G().currentMemberId);
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
  if (!hasGroup() || state.view === 'nuevo') return renderOnboarding();
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
  const due = t.done ? t.dueDate : dueOf(t);
  const overdue = !t.done && due < today;
  const meta = [];
  if (t.done) {
    const by = memById.get(t.doneBy);
    meta.push(`<span class="meta-item">${icon('check-circle')}${by ? esc(by.name) : 'Resuelta'} · ${relativeDay(t.doneAt)} ${fmtTime(t.doneAt)}</span>`);
  } else if (overdue) {
    meta.push(`<span class="meta-item meta-item--danger">${icon('alert')}${esc(dueLabel(due))}</span>`);
  } else if (due !== today && !hideDate) {
    meta.push(`<span class="meta-item">${icon('calendar')}${esc(dueLabel(due))}</span>`);
  }
  const who = memById.get(t.assignee);
  if (who && !t.done) meta.push(`<span class="meta-item">${avatar(who, 'xs')}${esc(who.name)}</span>`);
  if (isRepeating(t.repeat)) meta.push(`<span class="meta-item">${icon('repeat')}${esc(repeatLabel(t.repeat))}</span>`);
  if (t.note) meta.push(`<span class="meta-item">${icon('note')}${esc(t.note)}</span>`);

  const check = t.projected
    ? `<span class="todo__check todo__check--projected" title="Repetición prevista">${icon('repeat')}</span>`
    : `<button class="todo__check" data-check="${esc(t.id)}" aria-label="${t.done ? 'Marcar como pendiente' : 'Marcar como resuelta'}">${icon('check')}</button>`;
  return `<div class="todo ${t.done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''} ${t.projected ? 'is-projected' : ''}">
    ${check}
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
 * casillas de color (un toque = resuelta), debajo recientes y el catálogo del
 * grupo por categorías (un toque = pendiente para hoy). */
function tile({ title, iconName, active, overdue, cls = '', extra = '', attrs = '' }) {
  return `<button class="tile ${active ? 'tile--active' : ''} ${overdue ? 'tile--overdue' : ''} ${cls}" ${attrs}>
    ${extra}
    <span class="tile__icon">${icon(iconName)}</span>
    <span class="tile__name">${esc(title)}</span>
  </button>`;
}

/** Datos del catálogo del grupo activo + títulos "recientes" (usados pero no guardados). */
async function loadCatalog(all) {
  const gid = G().id;
  const [cats, its] = await Promise.all([db.categories(gid), db.items(gid)]);
  const itemTitles = new Set(its.map((i) => normalizeTitle(i.name)));
  const recent = [];
  const seen = new Set();
  for (const t of [...all].sort((a, b) => (b.doneAt || b.createdAt) - (a.doneAt || a.createdAt))) {
    const k = normalizeTitle(t.title);
    if (seen.has(k) || itemTitles.has(k)) continue;
    seen.add(k); recent.push({ name: t.title, icon: t.icon });
    if (recent.length >= 8) break;
  }
  return { cats, its, recent, itemByTitle: new Map(its.map((i) => [normalizeTitle(i.name), i])) };
}

async function renderHoy() {
  const [members, all] = await Promise.all([db.members(G().id), db.todos(G().id)]);
  const { cats, its, recent, itemByTitle } = await loadCatalog(all);
  const memById = new Map(members.map((m) => [m.id, m]));
  const today = todayKey();
  const pending = all.filter((t) => !t.done && t.dueDate <= today)
    .sort((a, b) => dueOf(a).localeCompare(dueOf(b)) || a.createdAt - b.createdAt);
  const doneToday = all.filter((t) => t.done && ymd(new Date(t.doneAt)) === today).sort((a, b) => b.doneAt - a.doneAt);
  const pendingByTitle = new Map(pending.map((t) => [normalizeTitle(t.title), t]));
  const upcomingCount = all.filter((t) => !t.done && t.dueDate > today).length;
  const recentFree = recent.filter((r) => !pendingByTitle.has(normalizeTitle(r.name)));

  const pendingTile = (t) => {
    const who = memById.get(t.assignee);
    const overdue = dueOf(t) < today;
    const badges = [
      overdue ? `<span class="tile__badge tile__badge--danger" title="Atrasada">${icon('alert')}</span>` : '',
      isRepeating(t.repeat) ? `<span class="tile__badge" title="${esc(repeatLabel(t.repeat))}">${icon('repeat')}</span>` : '',
      who ? avatar(who, 'xs') : ''
    ].join('');
    return tile({ title: t.title, iconName: t.icon, active: true, overdue,
      extra: badges ? `<span class="tile__badges">${badges}</span>` : '',
      attrs: `data-tile-todo="${esc(t.id)}" aria-label="Resolver ${esc(t.title)}"` });
  };
  // Casilla de una tarea habitual o reciente: si ya está pendiente sale en color.
  const addTile = (name, iconName, itemId = '') => {
    const p = pendingByTitle.get(normalizeTitle(name));
    if (p) return pendingTile(p);
    return tile({ title: name, iconName, attrs: `data-tile-add="${esc(name)}" data-tile-icon="${esc(iconName)}" ${itemId ? `data-item-id="${esc(itemId)}"` : ''} aria-label="Añadir ${esc(name)}"` });
  };
  const newItemTile = (catId) => `<button class="tile tile--add" data-new-item="${esc(catId)}" aria-label="Nueva tarea habitual">
      <span class="tile__icon">${icon('plus')}</span><span class="tile__name">Nueva</span></button>`;

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
  if (recentFree.length) {
    html += `<div class="section-title"><h2>Recientes</h2></div><div class="tiles">${recentFree.map((r) => addTile(r.name, r.icon)).join('')}</div>`;
  }
  const catIds = new Set(cats.map((c) => c.id));
  for (const cat of cats) {
    const list = its.filter((i) => i.categoryId === cat.id);
    html += `<div class="section-title"><h2>${esc(cat.name)}</h2>
        <button class="icon-btn icon-btn--sm" data-edit-cat="${esc(cat.id)}" aria-label="Editar categoría ${esc(cat.name)}">${icon('edit')}</button></div>
      <div class="tiles">${list.map((i) => addTile(i.name, i.icon, i.id)).join('')}${newItemTile(cat.id)}</div>`;
  }
  const orphans = its.filter((i) => !catIds.has(i.categoryId));
  if (orphans.length) {
    html += `<div class="section-title"><h2>Sin categoría</h2></div><div class="tiles">${orphans.map((i) => addTile(i.name, i.icon, i.id)).join('')}</div>`;
  }
  html += `<button class="btn btn--ghost btn--block" id="btn-new-cat" style="margin-bottom:12px">${icon('plus')}Nueva categoría</button>
    <p class="help center">Mantén pulsada una tarea del catálogo para editarla o cambiarla de categoría.</p>`;
  html += `</div>` + fab('Nueva tarea con fecha');
  view().innerHTML = html;

  wireTiles(all);
  wireTodoRows(all);
  $$('[data-goto]').forEach((b) => b.onclick = () => setView(b.dataset.goto));
  $$('[data-edit-cat]').forEach((b) => b.onclick = () => openCategoryModal(cats.find((c) => c.id === b.dataset.editCat)));
  $$('[data-new-item]').forEach((b) => b.onclick = () => openItemModal({ categoryId: b.dataset.newItem }));
  $('#btn-new-cat').onclick = () => openCategoryModal(null);
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
    const matches = searchItems(its, q).slice(0, 12);
    const recentMatches = searchItems(recentFree, q).slice(0, 6);
    const exact = itemByTitle.has(normalizeTitle(q)) || pendingByTitle.has(normalizeTitle(q))
      || recentFree.some((r) => normalizeTitle(r.name) === normalizeTitle(q));
    const guess = guessIcon(q, its);
    $('#search-results').innerHTML = `<div class="tiles">
      ${exact ? '' : tile({ title: q, iconName: guess, cls: 'tile--new', attrs: `data-tile-add="${esc(q)}" data-tile-icon="${esc(guess)}" data-new-title="1"` })}
      ${recentMatches.map((r) => addTile(r.name, r.icon)).join('')}
      ${matches.map((m) => addTile(m.name, m.icon, m.id)).join('')}
    </div><p class="help center">Toca para añadirla a hoy · El botón <b>+</b> de abajo permite elegir fecha</p>`;
    wireTiles(all);
  };
  input.oninput = renderResults;
  $('#search-add').onsubmit = async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    if (pendingByTitle.has(normalizeTitle(q))) { toast('Ya está pendiente'); return; }
    const hit = itemByTitle.get(normalizeTitle(q));
    await addForToday(hit ? hit.name : q, hit ? hit.icon : guessIcon(q, its), { isNew: !hit });
  };
  if (state.search) { renderResults(); input.focus(); }
}

async function addForToday(title, iconName, { isNew = false } = {}) {
  const todo = await db.addTodo({ groupId: G().id, title, icon: iconName, dueDate: todayKey(), createdBy: G().currentMemberId });
  state.search = '';
  scheduleAutoSync(); notifyCreated(todo);
  // Si es una tarea nueva, se ofrece guardarla en una categoría del catálogo.
  toast(`Añadida: ${title}`, 'ok', {
    action: isNew
      ? { label: 'Guardar en categoría', fn: () => openItemModal({ title, icon: iconName }) }
      : { label: 'Deshacer', fn: async () => { await db.deleteTodo(todo.id); scheduleAutoSync(); refresh(); } }
  });
  await renderHoy();
}

/* Toque = acción principal; pulsación larga (o clic derecho) = editar. */
function wireTiles(all) {
  const LONG_MS = 450;
  $$('[data-tile-todo], [data-tile-add]').forEach((el) => {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    let timer = null, longFired = false;
    const edit = async () => {
      const t = all.find((x) => x.id === el.dataset.tileTodo);
      if (t) return openTodoModal({ todo: t });
      const item = el.dataset.itemId && await db.getOne('items', el.dataset.itemId);
      openItemModal(item ? { item } : { title: el.dataset.tileAdd, icon: el.dataset.tileIcon });
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
      else addForToday(el.dataset.tileAdd, el.dataset.tileIcon, { isNew: !!el.dataset.newTitle });
    });
  });
}

/* ========================== Vista: PRÓXIMAS ============================= */
const PROJECT_DAYS = 28;   // Horizonte de las repeticiones previstas.
const PROJECT_MAX = 6;     // Máximo de repeticiones previstas por tarea.

/** Repeticiones futuras de las tareas que se repiten. Solo se muestran: la
 * tarea real de la siguiente fecha se crea al resolver la actual. */
function projectRepeats(pending, today) {
  const out = [];
  const limit = addDays(today, PROJECT_DAYS);
  const real = new Set(pending.map((t) => `${t.seriesId || t.id}@${t.dueDate}`));
  for (const t of pending) {
    if (!isRepeating(t.repeat)) continue;
    let due = currentDue(t.dueDate, t.repeat, today);
    for (let n = 0; n < PROJECT_MAX;) {
      due = nextDue(due, t.repeat, due);
      if (due > limit) break;
      if (due <= today || real.has(`${t.seriesId || t.id}@${due}`)) continue;
      out.push({ ...t, dueDate: due, projected: true });
      n++;
    }
  }
  return out;
}

async function renderProximas() {
  const [members, all] = await Promise.all([db.members(G().id), db.todos(G().id)]);
  const memById = new Map(members.map((m) => [m.id, m]));
  const today = todayKey();
  const open = all.filter((t) => !t.done);
  const upcoming = [...open.filter((t) => t.dueDate > today), ...projectRepeats(open, today)]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.projected ? 1 : 0) - (b.projected ? 1 : 0) || a.createdAt - b.createdAt);

  let html = '';
  if (!upcoming.length) {
    html += emptyCard('calendar', 'No hay nada planificado.<div class="muted text-sm" style="margin-top:6px">Pulsa <b>+</b> para programar una tarea para otro día.</div>');
  } else {
    const byDay = new Map();
    for (const t of upcoming) { if (!byDay.has(t.dueDate)) byDay.set(t.dueDate, []); byDay.get(t.dueDate).push(t); }
    for (const [day, list] of byDay) {
      const d = parseYmd(day);
      const label = day === addDays(today, 1) ? `Mañana · ${fmtShortDay(d)}` : fmtLongDate(d);
      html += `<div class="section-title"><h2>${esc(label)}</h2></div>` + todoList(list, memById, { hideDate: true });
    }
    if (upcoming.some((t) => t.projected)) html += `<p class="help center">${icon('repeat')} Cada repetición aparece en <b>Hoy</b> el día que toca. Al resolverla se planifica la siguiente.</p>`;
  }
  html += fab('Planificar tarea');
  view().innerHTML = html;
  wireTodoRows(all);
  $('#fab-add').onclick = () => openTodoModal({ dueDate: addDays(today, 1), when: 'date' });
}

/* =========================== Vista: HECHAS ============================== */
async function renderHechas() {
  const [members, all] = await Promise.all([db.members(G().id), db.todos(G().id)]);
  const memById = new Map(members.map((m) => [m.id, m]));
  const done = all.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt).slice(0, 150);
  const weekStart = startOfWeek(new Date()).getTime();
  const perMember = new Map();
  for (const t of done) if (t.doneAt >= weekStart && t.doneBy) perMember.set(t.doneBy, (perMember.get(t.doneBy) || 0) + 1);

  let html = '';
  if (perMember.size && !G().personal) {
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
async function openTodoModal({ todo = null, dueDate = todayKey(), when = '', title = '', icon: iconName = '' } = {}) {
  const gid = G().id;
  const [members, all] = await Promise.all([db.members(gid), db.todos(gid)]);
  const { cats, its, recent, itemByTitle } = await loadCatalog(all);
  const today = todayKey(), tomorrow = addDays(today, 1);
  const cur = todo ? { ...todo } : { title, icon: iconName || (title ? guessIcon(title, its) : 'sparkles'), dueDate, repeat: 'none', assignee: null, note: '' };
  let iconTouched = !!todo || !!iconName;
  // Repetición: una opción rápida del selector o «Personalizado» (cada N días/semanas/meses/años).
  const curRepeat = normalizeRepeat(cur.repeat);
  const repeatSel = REPEAT_PRESETS.includes(curRepeat) ? curRepeat : 'custom';
  const customRepeat = parseRepeat(curRepeat) || { n: 4, unit: 'w' };
  const whenMode = when || (cur.dueDate === today ? 'today' : cur.dueDate === tomorrow ? 'tomorrow' : 'date');
  const catName = (id) => (cats.find((c) => c.id === id) || {}).name || 'Sin categoría';
  // Opciones del selector "Elegir de tus tareas": catálogo + recientes.
  // En «Todas» van primero las recientes y luego el catálogo en el orden de sus categorías.
  const catPos = new Map(cats.map((c, i) => [c.id, i]));
  const sortedItems = [...its].sort((a, b) => (catPos.get(a.categoryId) ?? 99) - (catPos.get(b.categoryId) ?? 99) || (a.order || 0) - (b.order || 0));
  const picks = [...recent.map((r) => ({ name: r.name, icon: r.icon, cat: '__recent' })), ...sortedItems.map((i) => ({ name: i.name, icon: i.icon, cat: i.categoryId }))];

  openModal(todo ? 'Editar tarea' : 'Nueva tarea', `
    <div class="field"><label>¿Qué hay que hacer?</label>
      <input class="input" id="td-title" placeholder="Escribe o elige abajo" maxlength="80" value="${esc(cur.title)}">
    </div>
    ${todo ? '' : `
    <div class="field"><label>Elegir de tus tareas</label>
      <div class="chip-row" id="td-pcats">
        <button type="button" class="chip-btn is-active" data-pcat="">Todas</button>
        ${recent.length ? '<button type="button" class="chip-btn" data-pcat="__recent">Recientes</button>' : ''}
        ${cats.map((c) => `<button type="button" class="chip-btn" data-pcat="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
      </div>
      <div class="picks" id="td-picks"></div>
    </div>`}
    <div class="field"><label>¿Cuándo?</label>
      <div class="segment segment--block" id="td-when">
        <button type="button" data-when="today" class="${whenMode === 'today' ? 'is-active' : ''}">Hoy</button>
        <button type="button" data-when="tomorrow" class="${whenMode === 'tomorrow' ? 'is-active' : ''}">Mañana</button>
        <button type="button" data-when="date" class="${whenMode === 'date' ? 'is-active' : ''}">Otro día</button>
      </div>
      <input class="input ${whenMode === 'date' ? '' : 'hidden'}" type="date" id="td-date" value="${esc(cur.dueDate)}" min="${today}" style="margin-top:8px">
    </div>
    <div class="field"><label>Repetir</label>
      <select class="select" id="td-repeat">
        ${REPEAT_PRESETS.map((k) => `<option value="${k}" ${k === repeatSel ? 'selected' : ''}>${repeatLabel(k)}</option>`).join('')}
        <option value="custom" ${repeatSel === 'custom' ? 'selected' : ''}>Personalizado…</option>
      </select>
      <div class="repeat-custom ${repeatSel === 'custom' ? '' : 'hidden'}" id="td-repeat-custom">
        <span>Cada</span>
        <input class="input" type="number" id="td-repeat-n" min="1" max="365" inputmode="numeric" value="${customRepeat.n}">
        <select class="select" id="td-repeat-unit">
          ${Object.entries(REPEAT_UNITS).map(([k, l]) => `<option value="${k}" ${k === customRepeat.unit ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field ${G().personal ? 'hidden' : ''}"><label>¿A quién le toca?</label>
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
    <div class="field"><label>Guardar como tarea habitual</label>
      <select class="select" id="td-cat">
        <option value="">No guardar</option>
        ${cats.map((c) => `<option value="${esc(c.id)}">En «${esc(c.name)}»</option>`).join('')}
        <option value="__new">En una categoría nueva…</option>
      </select>
      <input class="input hidden" id="td-newcat" placeholder="Nombre de la nueva categoría" maxlength="30" style="margin-top:8px">
      <p class="help hidden" id="td-cat-info"></p>
    </div>
    <div class="modal__actions">
      ${todo ? `<button class="btn btn--danger" id="td-delete">${icon('trash')}Eliminar</button>` : ''}
      <button class="btn btn--primary" id="td-save">${todo ? 'Guardar' : 'Añadir'}</button>
    </div>`, {
    onMount(modal) {
      const titleInput = $('#td-title', modal);
      const dateInput = $('#td-date', modal);
      const catSelect = $('#td-cat', modal);
      const setIcon = (k) => {
        cur.icon = k;
        $$('[data-icon-pick]', modal).forEach((x) => x.classList.toggle('is-active', x.dataset.iconPick === k));
      };
      // "Guardar como tarea habitual": si ya está en el catálogo, solo se informa.
      const syncCatField = () => {
        const hit = itemByTitle.get(normalizeTitle(titleInput.value));
        catSelect.classList.toggle('hidden', !!hit);
        $('#td-newcat', modal).classList.toggle('hidden', !!hit || catSelect.value !== '__new');
        const info = $('#td-cat-info', modal);
        info.classList.toggle('hidden', !hit);
        if (hit) info.textContent = `Ya está en tu catálogo, en «${catName(hit.categoryId)}».`;
      };
      // Selector de tareas habituales (solo al crear).
      let pcat = '';
      const renderPicks = () => {
        const box = $('#td-picks', modal);
        if (!box) return;
        const q = normalizeTitle(titleInput.value);
        const list = picks.filter((p) => (!pcat || p.cat === pcat) && (!q || normalizeTitle(p.name).includes(q)));
        box.innerHTML = list.length
          ? list.map((p) => `<button type="button" class="pick ${normalizeTitle(p.name) === q ? 'is-active' : ''}" data-pick="${esc(p.name)}" data-pick-icon="${esc(p.icon)}">${icon(p.icon)}<span>${esc(p.name)}</span></button>`).join('')
          : '<p class="help" style="margin:4px 2px">Nada con ese nombre: se creará como tarea nueva.</p>';
        $$('[data-pick]', box).forEach((b) => b.onclick = () => {
          titleInput.value = b.dataset.pick;
          setIcon(b.dataset.pickIcon); iconTouched = true;
          renderPicks(); syncCatField();
        });
      };
      $$('[data-pcat]', modal).forEach((b) => b.onclick = () => {
        pcat = b.dataset.pcat;
        $$('[data-pcat]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
        renderPicks();
      });
      renderPicks(); syncCatField();

      titleInput.oninput = (e) => {
        if (!iconTouched) setIcon(guessIcon(e.target.value, its));
        renderPicks(); syncCatField();
      };
      catSelect.onchange = () => {
        syncCatField();
        if (catSelect.value === '__new') $('#td-newcat', modal).focus();
      };
      $$('[data-when]', modal).forEach((b) => b.onclick = () => {
        $$('[data-when]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
        const w = b.dataset.when;
        dateInput.classList.toggle('hidden', w !== 'date');
        if (w === 'today') dateInput.value = today;
        else if (w === 'tomorrow') dateInput.value = tomorrow;
        else { if (dateInput.value < tomorrow) dateInput.value = tomorrow; dateInput.focus(); }
      });
      const repeatSelect = $('#td-repeat', modal);
      repeatSelect.onchange = () => {
        $('#td-repeat-custom', modal).classList.toggle('hidden', repeatSelect.value !== 'custom');
        if (repeatSelect.value === 'custom') $('#td-repeat-n', modal).focus();
      };
      const readRepeat = () => repeatSelect.value !== 'custom' ? repeatSelect.value
        : normalizeRepeat(`${Math.min(365, parseInt($('#td-repeat-n', modal).value, 10) || 0)}${$('#td-repeat-unit', modal).value}`);
      $$('[data-mid]', modal).forEach((b) => b.onclick = () => {
        cur.assignee = b.dataset.mid || null;
        $$('[data-mid]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
      });
      $$('[data-icon-pick]', modal).forEach((b) => b.onclick = () => { setIcon(b.dataset.iconPick); iconTouched = true; });

      $('#td-save', modal).onclick = async () => {
        const name = titleInput.value.trim();
        if (!name) return toast('Escribe o elige qué hay que hacer', 'err');
        const due = dateInput.value || today;
        const repeat = readRepeat();
        if (repeatSelect.value === 'custom' && repeat === 'none') return toast('Indica cada cuánto se repite (1 a 365)', 'err');
        const fields = { title: name, icon: cur.icon, dueDate: due, repeat, assignee: cur.assignee, note: $('#td-note', modal).value.trim() };
        // Guardar en el catálogo (si se pidió y aún no está).
        if (!itemByTitle.has(normalizeTitle(name)) && catSelect.value) {
          let categoryId = catSelect.value;
          if (categoryId === '__new') {
            const cname = $('#td-newcat', modal).value.trim();
            if (!cname) return toast('Escribe el nombre de la categoría', 'err');
            categoryId = (await db.addCategory({ groupId: gid, name: cname })).id;
          }
          await db.addItem({ groupId: gid, name, icon: cur.icon, categoryId });
        }
        if (todo) {
          await db.updateTodo(todo.id, fields);
          closeModal(); toast('Tarea guardada', 'ok');
        } else {
          const created = await db.addTodo({ ...fields, groupId: gid, createdBy: G().currentMemberId });
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

/* ================ Modal: tarea habitual del catálogo ===================== */
/* Editar una tarea del catálogo, o guardar en él una reciente/nueva. */
async function openItemModal({ item = null, title = '', icon: iconName = '', categoryId = null } = {}) {
  const gid = G().id;
  const cats = await db.categories(gid);
  const cur = item ? { ...item } : { name: title, icon: iconName || (title ? guessIcon(title) : 'sparkles'), categoryId: categoryId || (cats[0] && cats[0].id) || null };
  let newCat = !cats.length;

  openModal(item ? 'Tarea habitual' : 'Guardar en el catálogo', `
    <div class="field"><label>Nombre</label>
      <input class="input" id="it-name" value="${esc(cur.name)}" placeholder="Ej: Limpiar el horno" maxlength="80">
    </div>
    <div class="field"><label>Categoría</label>
      <div class="person-picker" id="it-cats">
        ${cats.map((c) => `<button type="button" class="person-pick ${c.id === cur.categoryId && !newCat ? 'is-active' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
        <button type="button" class="person-pick ${newCat ? 'is-active' : ''}" data-cat="__new">${icon('plus')}Nueva</button>
      </div>
      <input class="input ${newCat ? '' : 'hidden'}" id="it-newcat" placeholder="Nombre de la nueva categoría" maxlength="30" style="margin-top:8px">
    </div>
    <div class="field"><label>Icono</label>
      <div class="icon-grid" id="it-icon">
        ${TASK_ICONS.map((k) => `<button type="button" class="${k === cur.icon ? 'is-active' : ''}" data-icon-pick="${k}" aria-label="${k}">${icon(k)}</button>`).join('')}
      </div>
    </div>
    <div class="modal__actions">
      ${item ? `<button class="btn btn--danger" id="it-delete">${icon('trash')}Quitar</button>` : ''}
      <button class="btn btn--primary" id="it-save">Guardar</button>
    </div>
    <button class="btn btn--ghost btn--block btn--sm" id="it-plan" style="margin-top:10px">${icon('calendar')}Planificar para otro día</button>`, {
    onMount(modal) {
      $$('[data-cat]', modal).forEach((b) => b.onclick = () => {
        newCat = b.dataset.cat === '__new';
        if (!newCat) cur.categoryId = b.dataset.cat;
        $$('[data-cat]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
        $('#it-newcat', modal).classList.toggle('hidden', !newCat);
        if (newCat) $('#it-newcat', modal).focus();
      });
      $$('[data-icon-pick]', modal).forEach((b) => b.onclick = () => {
        cur.icon = b.dataset.iconPick;
        $$('[data-icon-pick]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
      });
      $('#it-save', modal).onclick = async () => {
        const name = $('#it-name', modal).value.trim();
        if (!name) return toast('Escribe un nombre', 'err');
        let categoryId = cur.categoryId;
        if (newCat) {
          const cname = $('#it-newcat', modal).value.trim();
          if (!cname) return toast('Escribe el nombre de la categoría', 'err');
          categoryId = (await db.addCategory({ groupId: gid, name: cname })).id;
        }
        if (item) await db.updateItem(item.id, { name, icon: cur.icon, categoryId });
        else await db.addItem({ groupId: gid, name, icon: cur.icon, categoryId });
        closeModal(); toast(item ? 'Tarea habitual guardada' : 'Guardada en el catálogo', 'ok');
        scheduleAutoSync(); await refresh();
      };
      const del = $('#it-delete', modal);
      if (del) del.onclick = async () => {
        await db.deleteItem(item.id);
        closeModal(); toast(`«${item.name}» quitada del catálogo`, 'ok');
        scheduleAutoSync(); await refresh();
      };
      $('#it-plan', modal).onclick = () => openTodoModal({
        title: $('#it-name', modal).value.trim(), icon: cur.icon, dueDate: addDays(todayKey(), 1), when: 'date'
      });
    }
  });
}

/* ======================== Modal: categoría ============================== */
async function openCategoryModal(cat = null) {
  const gid = G().id;
  const cats = await db.categories(gid);
  const idx = cat ? cats.findIndex((c) => c.id === cat.id) : -1;
  const count = cat ? (await db.items(gid)).filter((i) => i.categoryId === cat.id).length : 0;

  openModal(cat ? 'Categoría' : 'Nueva categoría', `
    <div class="field"><label>Nombre</label>
      <input class="input" id="cat-name" value="${esc(cat ? cat.name : '')}" placeholder="Ej: Jardín" maxlength="30">
    </div>
    ${cat ? `
    <div class="field"><label>Posición</label>
      <div class="row">
        <button class="btn btn--sm" id="cat-up" ${idx <= 0 ? 'disabled' : ''}>${icon('chevron-up')}Subir</button>
        <button class="btn btn--sm" id="cat-down" ${idx >= cats.length - 1 ? 'disabled' : ''}>${icon('chevron-down')}Bajar</button>
      </div>
    </div>` : ''}
    <div class="modal__actions">
      ${cat ? `<button class="btn btn--danger" id="cat-delete">${icon('trash')}Eliminar</button>` : ''}
      <button class="btn btn--primary" id="cat-save">${cat ? 'Guardar' : 'Crear'}</button>
    </div>`, {
    onMount(modal) {
      const input = $('#cat-name', modal);
      if (!cat) input.focus();
      $('#cat-save', modal).onclick = async () => {
        const name = input.value.trim();
        if (!name) return toast('Escribe un nombre', 'err');
        if (cat) await db.updateCategory(cat.id, { name });
        else await db.addCategory({ groupId: gid, name, order: cats.length ? (cats[cats.length - 1].order || 0) + 1 : 0 });
        closeModal(); toast(cat ? 'Categoría guardada' : `Categoría «${name}» creada`, 'ok');
        scheduleAutoSync(); await refresh();
      };
      // Reordenar: se renumeran todas y se intercambia con la vecina.
      const move = async (delta) => {
        const list = [...cats];
        const [moved] = list.splice(idx, 1);
        list.splice(idx + delta, 0, moved);
        for (let i = 0; i < list.length; i++) if (list[i].order !== i) await db.updateCategory(list[i].id, { order: i });
        closeModal(); scheduleAutoSync(); await refresh();
      };
      const up = $('#cat-up', modal), down = $('#cat-down', modal);
      if (up) up.onclick = () => move(-1);
      if (down) down.onclick = () => move(1);
      const del = $('#cat-delete', modal);
      if (del) del.onclick = async () => {
        const msg = count
          ? `¿Eliminar «${cat.name}» y sus ${count} tarea${count === 1 ? '' : 's'} habitual${count === 1 ? '' : 'es'}? Las tareas pendientes no se tocan.`
          : `¿Eliminar la categoría «${cat.name}»?`;
        if (!await confirmDialog(msg, { danger: true, okText: 'Eliminar' })) return;
        await db.deleteCategory(cat.id);
        toast('Categoría eliminada', 'ok'); scheduleAutoSync(); await refresh();
      };
    }
  });
}

/* ================== Grupos: crear, unirse, cambiar y salir =============== */
let pendingInvite = null; // Invitación recibida por enlace, para rellenar el formulario.

function nextColor(used) {
  return MEMBER_COLORS.find((c) => !used.includes(c)) || MEMBER_COLORS[used.length % MEMBER_COLORS.length];
}

/* Pantalla para crear un grupo (compartido o privado) o unirse a uno. Es la
 * bienvenida cuando aún no hay grupos y la vista "nuevo" cuando ya los hay. */
function renderOnboarding() {
  const s = state.settings;
  const first = !hasGroup();
  const mode = pendingInvite ? 'join' : (state.onboardMode || 'shared'); // shared | personal | join
  const hasPersonal = s.groups.some((g) => g.personal);
  const defaultName = mode === 'personal' ? (hasPersonal ? '' : PERSONAL_GROUP)
    : (s.groups.some((g) => g.name === DEFAULT_GROUP) ? '' : DEFAULT_GROUP);
  const hints = {
    shared: 'Para compartir las tareas con tu pareja o familia: todos veis las mismas y cualquiera puede resolverlas.',
    personal: 'Tus propias tareas pendientes: solo las ves tú.',
    join: 'Con la invitación que te ha enviado quien creó el grupo.'
  };

  view().innerHTML = `
    <div class="onboard">
      ${first ? `
        <div class="onboard__logo">${icon('home')}</div>
        <h1>Tareas</h1>
        <p class="muted">Tareas pendientes de hoy y las que estén por venir, solo para ti o compartidas con tu pareja o familia.</p>`
      : `<div class="flex-between"><h2 class="list-head__title">Nuevo grupo</h2><button class="btn btn--ghost btn--sm" id="ob-cancel">Cancelar</button></div>`}

      <div class="segment segment--block" style="margin:22px 0 10px">
        <button data-mode="shared" class="${mode === 'shared' ? 'is-active' : ''}">${icon('users')}Compartido</button>
        <button data-mode="personal" class="${mode === 'personal' ? 'is-active' : ''}">${icon('lock')}Privado</button>
        <button data-mode="join" class="${mode === 'join' ? 'is-active' : ''}">${icon('link')}Unirme</button>
      </div>
      <p class="help onboard__hint">${hints[mode]}</p>

      <div class="card">
        ${mode !== 'join' ? `
          <div class="field"><label>Nombre del grupo</label>
            <input class="input" id="ob-group" value="${esc(defaultName)}" placeholder="${mode === 'personal' ? 'Ej: Mis tareas' : 'Ej: Tareas Hogar'}" maxlength="40">
          </div>
          <div class="field"><label>Tu nombre</label>
            <input class="input" id="ob-name" value="${esc(s.myName)}" placeholder="Ej: Juan" maxlength="30" autocomplete="given-name">
            ${mode === 'shared' ? '<p class="help">Así te verán los demás miembros del grupo.</p>' : ''}
          </div>
          <div class="field">
            <label class="flex-between" style="cursor:pointer">
              <span>Enviar avisos al móvil (ntfy)</span>
              <input type="checkbox" id="ob-notify" ${mode === 'shared' ? 'checked' : ''} class="switch">
            </label>
            <p class="help">${mode === 'shared' ? 'Os avisa cuando alguien añade o resuelve una tarea.' : 'Te avisa en tu móvil al añadir o resolver tareas.'} Se puede cambiar después.</p>
          </div>
          ${mode === 'shared' && !hasPersonal ? `
          <div class="field">
            <label class="flex-between" style="cursor:pointer">
              <span>Crear también mi grupo privado «${PERSONAL_GROUP}»</span>
              <input type="checkbox" id="ob-personal-too" checked class="switch">
            </label>
          </div>` : ''}
          <button class="btn btn--primary btn--block" id="ob-create">Crear grupo</button>
          <p class="help" style="margin-top:12px">${mode === 'shared'
            ? 'Después, en la pestaña <b>Grupo</b>, conectas Google Sheets, activas los avisos e invitas a tu pareja.'
            : 'Si quieres tenerlo en varios dispositivos tuyos, conecta una Google Sheet en la pestaña <b>Grupo</b>.'}</p>
        ` : `
          ${pendingInvite ? `<div class="invite-box">${icon('link')}<div>Invitación al grupo <b>${esc(pendingInvite.groupName || DEFAULT_GROUP)}</b></div></div>` : `
          <div class="field"><label>Invitación</label>
            <input class="input" id="ob-code" placeholder="Pega aquí el enlace o el código" autocapitalize="off" autocomplete="off" spellcheck="false">
            <p class="help">Pídesela a quien creó el grupo: Grupo → Invitar a alguien.</p>
          </div>`}
          <div class="field"><label>Tu nombre</label>
            <input class="input" id="ob-name" value="${esc(s.myName)}" placeholder="Ej: Ana" maxlength="30" autocomplete="given-name">
          </div>
          <button class="btn btn--primary btn--block" id="ob-join">Unirme</button>
        `}
      </div>
    </div>`;

  $$('[data-mode]').forEach((b) => b.onclick = () => {
    state.onboardMode = b.dataset.mode;
    if (b.dataset.mode !== 'join') pendingInvite = null;
    renderOnboarding();
  });
  const cancel = $('#ob-cancel');
  if (cancel) cancel.onclick = () => { pendingInvite = null; state.onboardMode = null; setView('hoy'); };

  const createBtn = $('#ob-create');
  if (createBtn) createBtn.onclick = async () => {
    const personal = mode === 'personal';
    const name = $('#ob-group').value.trim();
    const myName = $('#ob-name').value.trim();
    if (!name) return toast('Ponle un nombre al grupo', 'err');
    if (!myName) return toast('Escribe tu nombre', 'err');
    const alsoPersonal = !!($('#ob-personal-too') && $('#ob-personal-too').checked);
    const withNotify = $('#ob-notify').checked;
    await db.saveSettings({ myName });
    await createGroup({ name, personal, myName, notifyEnabled: withNotify });
    if (alsoPersonal) await createGroup({ name: PERSONAL_GROUP, personal: true, myName, activate: false });
    state.settings = await db.getSettings();
    state.onboardMode = null;
    toast(alsoPersonal ? `Grupos «${name}» y «${PERSONAL_GROUP}» creados` : `Grupo «${name}» creado`, 'ok');
    await setView(personal ? 'hoy' : 'grupo');
  };

  const joinBtn = $('#ob-join');
  if (joinBtn) joinBtn.onclick = async () => {
    const myName = $('#ob-name').value.trim();
    let invite = pendingInvite;
    if (!invite) {
      invite = parseInvite($('#ob-code').value.trim());
      if (!invite) return toast('La invitación no es válida', 'err');
    }
    if (!myName) return toast('Escribe tu nombre', 'err');
    await joinGroup(invite, myName);
  };
}

async function createGroup({ name, personal, myName, notifyEnabled = !personal, activate = true }) {
  // El tema se genera siempre: así activar los avisos más tarde es un solo toque.
  const group = await db.addGroup({ name, personal, ntfyTopic: randomTopic(name), notifyEnabled }, { activate });
  const me = await db.addMember({ groupId: group.id, name: myName, color: MEMBER_COLORS[0] });
  await db.seedCatalog(group.id);
  state.settings = await db.updateGroup(group.id, { currentMemberId: me.id });
  return group;
}

/** Grupo de este móvil que corresponde a una invitación (misma hoja o mismo tema). */
function findGroupForInvite(invite) {
  return state.settings.groups.find((g) => (invite.syncUrl && g.syncUrl === invite.syncUrl)
    || (!invite.syncUrl && isValidTopic(invite.ntfyTopic) && g.ntfyTopic === invite.ntfyTopic)) || null;
}

async function joinGroup(invite, myName) {
  const existing = findGroupForInvite(invite);
  if (existing) {
    pendingInvite = null;
    await switchGroup(existing.id);
    return toast(`Ya estás en «${existing.name}»`);
  }
  await db.saveSettings({ myName });
  let group = await db.addGroup({
    name: invite.groupName || DEFAULT_GROUP, personal: false,
    syncUrl: invite.syncUrl || '', syncSecret: invite.syncSecret || '', autoSync: true,
    ntfyServer: invite.ntfyServer || 'https://ntfy.sh', ntfyTopic: isValidTopic(invite.ntfyTopic) ? invite.ntfyTopic : '',
    notifyEnabled: isValidTopic(invite.ntfyTopic)
  });
  // Primero traemos el grupo (miembros y catálogo) para elegir un color libre
  // y no duplicar nombre. Sin hoja no hay nada que traer: catálogo inicial.
  if (group.syncUrl) { try { await syncNow(group); } catch (e) { console.warn(e); } }
  else await db.seedCatalog(group.id);
  const existingMembers = await db.members(group.id);
  const same = existingMembers.find((m) => m.name.trim().toLowerCase() === myName.toLowerCase());
  const me = same || await db.addMember({ groupId: group.id, name: myName, color: nextColor(existingMembers.map((m) => m.color)) });
  state.settings = await db.updateGroup(group.id, { currentMemberId: me.id });
  group = G();
  pendingInvite = null;
  state.onboardMode = null;
  toast(`Te has unido a «${group.name}»`, 'ok');
  await setView('hoy');
  if (group.syncUrl) doSync(true, group.id);
  else toast('La invitación no trae Google Sheets: no se compartirán las tareas', 'err');
}

async function switchGroup(id) {
  state.settings = await db.saveSettings({ activeGroupId: id });
  state.search = '';
  state.showDoneToday = false;
  closeModal();
  await setView(state.view === 'nuevo' ? 'hoy' : state.view);
  doSync(true, id);
}

function openNewGroup(mode) {
  closeModal();
  pendingInvite = null;
  state.onboardMode = mode;
  setView('nuevo');
}

/* Selector de grupo (se abre al tocar el nombre en la cabecera). */
async function openGroupSwitcher() {
  if (!hasGroup()) return;
  const today = todayKey();
  const current = G().id;
  const rows = await Promise.all(state.settings.groups.map(async (g) => {
    const n = (await db.todos(g.id)).filter((t) => !t.done && t.dueDate <= today).length;
    return { g, n };
  }));
  openModal('Tus grupos', `
    <div class="card card--pad0">
      ${rows.map(({ g, n }) => `
        <button class="group-row ${g.id === current ? 'is-active' : ''}" data-switch="${esc(g.id)}">
          <span class="group-row__icon">${icon(g.personal ? 'lock' : 'users')}</span>
          <span class="list-item__body">
            <span class="list-item__title">${esc(g.name)}</span>
            <span class="list-item__sub">${g.personal ? 'Privado' : 'Compartido'}${g.syncUrl ? '' : ' · solo en este móvil'}${g.notifyEnabled && isValidTopic(g.ntfyTopic) ? '' : ' · sin avisos'}</span>
          </span>
          ${n ? `<span class="badge" title="Pendientes hoy">${n}</span>` : ''}
          ${g.id === current ? icon('check', { cls: 'group-row__check' }) : ''}
        </button>`).join('')}
    </div>
    <div class="group-actions">
      <button class="btn btn--block" data-new="shared">${icon('users')}Nuevo grupo compartido</button>
      <button class="btn btn--block" data-new="personal">${icon('lock')}Nuevo grupo privado</button>
      <button class="btn btn--ghost btn--block" data-new="join">${icon('link')}Unirme con una invitación</button>
    </div>`, {
    onMount(modal) {
      $$('[data-switch]', modal).forEach((b) => b.onclick = () => (b.dataset.switch === current ? closeModal() : switchGroup(b.dataset.switch)));
      $$('[data-new]', modal).forEach((b) => b.onclick = () => openNewGroup(b.dataset.new));
    }
  });
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
    const m = raw.match(/#join=([-_A-Za-z0-9]+)/);
    const b64 = (m ? m[1] : raw).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const cfg = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    if (!cfg || cfg.v !== 2) return null;
    return cfg;
  } catch { return null; }
}
function inviteUrl() {
  const g = G();
  const code = encodeInvite({ v: 2, groupName: g.name, syncUrl: g.syncUrl, syncSecret: g.syncSecret, ntfyServer: g.ntfyServer, ntfyTopic: g.ntfyTopic });
  return `${location.origin}${location.pathname}#join=${code}`;
}
async function shareInvite() {
  const g = G();
  if (!g.syncUrl && !await confirmDialog('Aún no has conectado Google Sheets: sin eso la otra persona no verá vuestras tareas. ¿Enviar la invitación igualmente?', { okText: 'Enviar' })) return;
  const url = inviteUrl();
  const text = `Únete a «${g.name}» en Tareas. Abre el enlace o pégalo en la app (Unirme):`;
  if (navigator.share) {
    try { await navigator.share({ title: g.name, text, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Invitación copiada: envíasela a tu pareja', 'ok'); }
  catch { prompt('Copia esta invitación y envíasela:', url); }
}
/* Si la app se abre con un enlace de invitación, se ofrece unirse (es un
 * grupo más: no hace falta salir de los que ya tengas). */
async function checkInviteLink() {
  if (!location.hash.startsWith('#join=')) return;
  const invite = parseInvite(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  if (!invite) return toast('La invitación no es válida', 'err');
  const existing = findGroupForInvite(invite);
  if (existing) {
    await switchGroup(existing.id);
    return toast(`Ya estás en «${existing.name}»`);
  }
  pendingInvite = invite;
  state.onboardMode = 'join';
  await setView('nuevo');
}

async function leaveGroup() {
  const g = G();
  const msg = g.personal
    ? `¿Eliminar el grupo privado «${g.name}»? Se borrarán sus tareas de este móvil${g.syncUrl ? ' (la copia en Google Sheets se mantiene)' : ''}.`
    : `¿Salir de «${g.name}»? Se borrarán de este móvil sus tareas. Los demás miembros las conservan.`;
  if (!await confirmDialog(msg, { danger: true, okText: g.personal ? 'Eliminar grupo' : 'Salir del grupo' })) return;
  // En un grupo compartido avisamos al resto de que ya no estamos.
  if (!g.personal && g.currentMemberId) {
    await db.deleteMember(g.currentMemberId);
    if (g.syncUrl) { try { await syncNow(g); } catch (e) { console.warn(e); } }
  }
  state.settings = await db.removeGroup(g.id);
  toast(g.personal ? `Grupo «${g.name}» eliminado` : `Has salido de «${g.name}»`, 'ok');
  await setView('hoy');
}

/* ============================ Vista: GRUPO ============================== */
async function renderGrupo() {
  const g = G();
  const personal = g.personal;
  const members = (await db.members(g.id)).sort((a, b) => (a.id === g.currentMemberId ? -1 : b.id === g.currentMemberId ? 1 : a.name.localeCompare(b.name)));
  const lastSync = g.lastSyncAt ? `${relativeDay(g.lastSyncAt)} ${fmtTime(g.lastSyncAt)}` : 'Nunca';
  const notifyOn = g.notifyEnabled && isValidTopic(g.ntfyTopic);
  const save = async (patch) => { state.settings = await db.updateGroup(g.id, patch); };

  view().innerHTML = `
    <div class="card group-head">
      <div class="group-head__logo">${icon(personal ? 'lock' : 'users')}</div>
      <div class="list-item__body">
        <div class="group-head__name">${esc(g.name)}</div>
        <div class="muted text-sm">${personal ? 'Privado · solo tú' : `Compartido · ${members.length} miembro${members.length === 1 ? '' : 's'}`}</div>
      </div>
      <button class="icon-btn" id="btn-rename" aria-label="Cambiar nombre del grupo">${icon('edit')}</button>
    </div>

    <!-- Tipo de grupo -->
    <div class="section-title"><h2>Tipo de grupo</h2></div>
    <div class="card">
      <div class="segment segment--block" id="set-type">
        <button data-type="shared" class="${personal ? '' : 'is-active'}">${icon('users')}Compartido</button>
        <button data-type="private" class="${personal ? 'is-active' : ''}">${icon('lock')}Privado</button>
      </div>
      <p class="help mb-0">${personal
        ? 'Solo tú ves estas tareas: sin miembros ni invitaciones.'
        : 'Compartes estas tareas con otras personas. Invítalas desde aquí abajo.'}</p>
    </div>

    ${personal ? '' : `
    <!-- Miembros -->
    <div class="section-title"><h2>Miembros</h2></div>
    <div class="card card--pad0"><div class="list">
      ${members.map((m) => `
        <div class="list-item">
          ${avatar(m, 'lg')}
          <div class="list-item__body"><div class="list-item__title">${esc(m.name)}</div>
            ${m.id === g.currentMemberId ? '<div class="list-item__sub">Tú, en este móvil</div>' : ''}</div>
          ${m.id === g.currentMemberId
            ? `<button class="delete-x" id="btn-me-edit" aria-label="Cambiar tu nombre">${icon('edit')}</button>`
            : `<button class="delete-x" data-del-member="${esc(m.id)}" aria-label="Quitar del grupo">${icon('x')}</button>`}
        </div>`).join('')}
    </div></div>
    <button class="btn btn--primary btn--block" id="btn-invite" style="margin-bottom:6px">${icon('share')}Invitar a alguien</button>
    <p class="help" style="margin-bottom:22px">Envía la invitación a tu pareja por WhatsApp o similar. Al abrirla, escribirá su nombre y aparecerá aquí.</p>`}

    <!-- Sincronización -->
    <div class="section-title"><h2>${personal ? 'Copia en Google Sheets (opcional)' : 'Compartir tareas (Google Sheets)'}</h2></div>
    <div class="card">
      <div class="sync-status" style="margin-bottom:12px">
        <span class="sync-dot ${g.syncUrl ? 'sync-dot--ok' : 'sync-dot--off'}"></span>
        <span>${g.syncUrl ? 'Conectado · Última: ' + esc(lastSync) : 'Sin conectar: las tareas solo están en este móvil'}</span>
      </div>
      ${personal ? '<p class="help" style="margin:-4px 0 12px">Úsalo si quieres tus tareas en varios dispositivos o como copia de seguridad. Usa una hoja distinta a la de tus otros grupos.</p>' : ''}
      <div class="field"><label>URL del Web App (Google Apps Script)</label>
        <input class="input" id="set-url" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(g.syncUrl)}" autocapitalize="off" spellcheck="false">
      </div>
      <div class="field"><label>Clave secreta (opcional)</label>
        <input class="input" id="set-secret" placeholder="Debe coincidir con SECRET del script" value="${esc(g.syncSecret)}" autocapitalize="off" spellcheck="false">
      </div>
      <div class="field">
        <label class="flex-between" style="cursor:pointer">
          <span>Sincronizar automáticamente</span>
          <input type="checkbox" id="set-autosync" ${g.autoSync ? 'checked' : ''} class="switch">
        </label>
      </div>
      <div class="row" style="margin-bottom:10px">
        <button class="btn" id="btn-test">Probar</button>
        <button class="btn btn--primary" id="btn-savesync">Guardar</button>
      </div>
      <button class="btn btn--ghost btn--block btn--sm" id="btn-guide">${icon('book')}Cómo configurar Google Sheets</button>
    </div>

    <!-- Notificaciones -->
    <div class="section-title"><h2>Avisos al móvil</h2></div>
    <div class="card">
      <label class="toggle-row">
        <span class="toggle-row__text">
          <span class="toggle-row__title">${icon('bell')}Enviar avisos</span>
          <span class="help">${personal
            ? 'Te avisa en tu móvil (app ntfy) al añadir o resolver tareas.'
            : 'Avisa a los miembros (app ntfy) cuando alguien añade o resuelve una tarea.'}</span>
        </span>
        <input type="checkbox" id="set-notify" ${notifyOn ? 'checked' : ''} class="switch">
      </label>
      ${notifyOn ? `
      <div class="notify-config">
        <div class="field"><label>Tema de ntfy</label>
          <div class="input-group">
            <input class="input" id="set-topic" placeholder="tareas-hogar-xxxx" value="${esc(g.ntfyTopic)}" autocapitalize="off" autocomplete="off" spellcheck="false">
            <button class="btn" id="btn-topic-gen" title="Generar tema aleatorio" aria-label="Generar tema aleatorio">${icon('key')}</button>
          </div>
          <p class="help">${personal ? 'Cada grupo usa su propio tema.' : 'Va incluido en la invitación.'} Quien conozca el tema puede leer los avisos: no lo publiques.</p>
        </div>
        <div class="field"><label>Servidor ntfy</label>
          <input class="input" id="set-ntfy-server" placeholder="https://ntfy.sh" value="${esc(g.ntfyServer)}" autocapitalize="off" spellcheck="false">
        </div>
        <div class="row" style="margin-bottom:10px">
          <button class="btn" id="btn-notify-test">${icon('send')}Probar</button>
          <button class="btn btn--primary" id="btn-notify-save">Guardar</button>
        </div>
        <button class="btn btn--ghost btn--block btn--sm" id="btn-notify-guide">${icon('book')}Cómo recibirlos en el móvil</button>
      </div>` : ''}
    </div>

    <button class="btn btn--danger btn--block" id="btn-leave" style="margin-top:8px">${icon(personal ? 'trash' : 'logout')}${personal ? 'Eliminar grupo' : 'Salir del grupo'}</button>
  `;

  // --- Grupo y miembros ---
  $('#btn-rename').onclick = () => promptText('Nombre del grupo', g.name, 40, async (v) => {
    await save({ name: v });
    toast(personal ? 'Nombre cambiado' : 'Nombre cambiado. Reenvía la invitación si quieres que lo vean igual.', 'ok');
    await refresh();
  });
  const meEdit = $('#btn-me-edit');
  if (meEdit) meEdit.onclick = async () => {
    const me = await db.getOne('members', g.currentMemberId);
    promptText('Tu nombre', me ? me.name : '', 30, async (v) => {
      await db.updateMember(g.currentMemberId, { name: v });
      state.settings = await db.saveSettings({ myName: v });
      scheduleAutoSync(); await renderGrupo();
    });
  };
  $$('[data-del-member]').forEach((b) => b.onclick = async () => {
    const m = members.find((x) => x.id === b.dataset.delMember);
    if (await confirmDialog(`¿Quitar a ${m.name} del grupo? Sus tareas resueltas se conservan.`, { danger: true, okText: 'Quitar' })) {
      await db.deleteMember(m.id); scheduleAutoSync(); await renderGrupo();
    }
  });
  $$('[data-type]').forEach((b) => b.onclick = async () => {
    const toPrivate = b.dataset.type === 'private';
    if (toPrivate === personal) return;
    if (toPrivate && members.length > 1 && !await confirmDialog(
      `«${g.name}» tiene ${members.length} miembros. Al hacerlo privado dejarás de ver miembros e invitaciones en este móvil, pero quien ya esté dentro seguirá viendo las tareas mientras uséis la misma Google Sheet. ¿Continuar?`,
      { okText: 'Hacer privado' })) return;
    await save({ personal: toPrivate });
    toast(toPrivate ? 'Ahora es un grupo privado' : 'Ahora es un grupo compartido: ya puedes invitar a alguien', 'ok');
    await refresh();
  });
  const inviteBtn = $('#btn-invite');
  if (inviteBtn) inviteBtn.onclick = shareInvite;
  $('#btn-leave').onclick = leaveGroup;

  // --- Sincronización ---
  $('#btn-test').onclick = async () => {
    const url = $('#set-url').value.trim();
    if (!url) return toast('Introduce la URL', 'err');
    toast('Probando…');
    try { const r = await testConnection(url, $('#set-secret').value.trim()); toast(`Conexión correcta · ${r.count} registros`, 'ok'); }
    catch (e) { toast('Error: ' + e.message, 'err'); }
  };
  $('#btn-savesync').onclick = async () => {
    const url = $('#set-url').value.trim();
    const other = url && state.settings.groups.find((x) => x.id !== g.id && x.syncUrl === url);
    if (other) return toast(`Esa hoja ya la usa «${other.name}». Cada grupo necesita la suya.`, 'err');
    const bad = url && checkSyncUrl(url);
    if (bad) return toast(bad, 'err');
    await save({ syncUrl: url, syncSecret: $('#set-secret').value.trim(), autoSync: $('#set-autosync').checked });
    await renderGrupo();
    if (url) await doSync(false, g.id);
  };
  $('#set-autosync').onchange = (e) => save({ autoSync: e.target.checked });
  $('#btn-guide').onclick = openGuideModal;

  // --- Notificaciones ---
  $('#set-notify').onchange = async (e) => {
    const on = e.target.checked;
    const patch = { notifyEnabled: on };
    if (on && !isValidTopic(g.ntfyTopic)) patch.ntfyTopic = randomTopic(g.name);
    await save(patch);
    await renderGrupo();
    if (on) toast('Avisos activados: suscríbete al tema en la app ntfy', 'ok', { action: { label: 'Cómo', fn: () => openNotifyGuideModal(G()) } });
    else toast('Avisos desactivados');
  };
  if (!notifyOn) return;
  const readNotifyForm = () => ({
    ntfyTopic: $('#set-topic').value.trim(),
    ntfyServer: $('#set-ntfy-server').value.trim() || 'https://ntfy.sh'
  });
  $('#btn-topic-gen').onclick = async () => {
    if ($('#set-topic').value.trim() && !await confirmDialog(`Si cambias el tema, ${personal ? 'tendrás' : 'todos tendréis'} que suscribiros de nuevo en ntfy${personal ? '' : ' (y reenviar la invitación)'}. ¿Generar uno nuevo?`, { okText: 'Generar' })) return;
    $('#set-topic').value = randomTopic(g.name);
  };
  $('#btn-notify-save').onclick = async () => {
    const f = readNotifyForm();
    if (!isValidTopic(f.ntfyTopic)) return toast('El tema no es válido', 'err');
    await save(f);
    toast('Avisos guardados', 'ok');
    await renderGrupo();
  };
  $('#btn-notify-test').onclick = async () => {
    const f = readNotifyForm();
    if (!isValidTopic(f.ntfyTopic)) return toast('Escribe o genera un tema', 'err');
    try { await testNotify(f.ntfyServer, f.ntfyTopic, g.name); toast('Aviso de prueba enviado', 'ok'); }
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
      <div><div class="list-item__title">Tareas</div><div class="muted text-sm">Versión ${APP_VERSION}</div></div>
      <button class="btn btn--sm" id="btn-changelog">Novedades</button>
    </div>
    <p class="help center" style="margin-top:16px">Hecho con ${icon('heart', { cls: 'ico--heart' })} · Datos guardados en tu dispositivo (IndexedDB).</p>
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
      <li><b>Autorízalo:</b> elige la función <code>doGet</code> en el desplegable de arriba y pulsa <b>Ejecutar</b> → Revisar permisos → tu cuenta → Configuración avanzada → Ir a … (no seguro) → <b>Permitir</b>. Sin esto la app da «Acceso denegado».</li>
      <li>Pulsa <b>Implementar → Nueva implementación</b>.</li>
      <li>Tipo: <b>Aplicación web</b>. Ejecutar como: <b>Yo</b>. Quién tiene acceso: <b>Cualquier usuario</b>.</li>
      <li>Copia la <b>URL</b> que termina en <code>/exec</code>, pégala en Grupo → Compartir tareas y pulsa <b>Guardar</b>.</li>
      <li>Pulsa <b>Invitar a alguien</b>: la invitación ya lleva la URL, tu pareja no tiene que copiar nada.</li>
    </ol>
    <p class="help">El aviso de «no seguro» sale porque el script es tuyo y Google no lo ha revisado. Para comprobarlo, abre la URL en incógnito: debe mostrar <code>{"ok":true,…}</code>. Si cambias el código, crea una <b>nueva versión</b> de la implementación. Si añades una <code>SECRET</code> en el código, ponla también en el campo "Clave secreta".</p>
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
      <li>Si tu versión de ntfy lo permite, ponle como nombre visible <b>${esc(G().name)}</b>.</li>
      ${G().personal ? '' : '<li>Tu pareja hace lo mismo en su móvil (el tema le llega con la invitación).</li>'}
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
  a.download = `tareas-backup-${ymd(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Copia exportada', 'ok');
}
async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!hasGroup()) return toast('Crea antes un grupo', 'err');
    await db.importAll(payload, { merge: true, fallbackGroupId: G().id });
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
  $('#group-switch').onclick = openGroupSwitcher;

  // Navegación
  $$('.tabbar__item').forEach((b) => b.onclick = () => setView(b.dataset.view));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('hashchange', checkInviteLink);

  await setView('hoy');
  window.__tareasBooted = true; // Ver el arranque de seguridad de index.html.
  await checkInviteLink();
  if (!$('.modal-overlay')) await showWhatsNewIfUpdated();

  // Sincronización inicial y periódica en segundo plano (+ avisos pendientes).
  startBackgroundSync();

  // Service Worker
  if ('serviceWorker' in navigator) {
    // updateViaCache 'none': comprobar sw.js siempre en la red (no en la caché HTTP).
    try { await navigator.serviceWorker.register(new URL('sw.js', window.location.href), { updateViaCache: 'none' }); }
    catch (err) { console.warn('SW no registrado:', err); }
  }
}

init();
