/* Punto de entrada y orquestación de la interfaz. */
import * as db from './db.js';
import { syncNow, testConnection } from './sync.js';
import { computeStats, donutSegments } from './stats.js';
import { APP_VERSION, CHANGELOG } from './changelog.js';
import { icon, taskIcon, TASK_ICONS } from './icons.js';
import { notify, flushQueue, testNotify, randomTopic, isValidTopic, topicUrl } from './notify.js';

/* =============================== Constantes ============================== */
const ACCENTS = ['#4f8cff', '#7c5cff', '#ff5c8a', '#ff7a45', '#f5b545', '#35c98b', '#22c3d6', '#8b5cf6', '#ef4444', '#14b8a6'];
const MEMBER_COLORS = ['#4f8cff', '#ff5c8a', '#35c98b', '#f5b545', '#7c5cff', '#ff7a45', '#22c3d6', '#ef4444'];
const DAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAYS_LONG = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const SEED_TASKS = [
  { name: 'Fregar los platos', icon: 'dishes', points: 1 },
  { name: 'Pasar la aspiradora', icon: 'broom', points: 2 },
  { name: 'Limpiar el baño', icon: 'toilet', points: 3 },
  { name: 'Sacar la basura', icon: 'trash', points: 1 },
  { name: 'Cocinar', icon: 'cooking', points: 2 },
  { name: 'Poner la lavadora', icon: 'washer', points: 1 }
];

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
  weekOffset: 0,
  statsPeriod: 'week',
  statsMetric: 'points'
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
function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function weekKeyFromOffset(offset) {
  const s = startOfWeek(new Date());
  s.setDate(s.getDate() + offset * 7);
  return ymd(s);
}
function parseYmd(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function dayDate(weekKey, day) { const d = parseYmd(weekKey); d.setDate(d.getDate() + day); return d; }
function isSameDay(ts, date) {
  const a = new Date(ts);
  return a.getFullYear() === date.getFullYear() && a.getMonth() === date.getMonth() && a.getDate() === date.getDate();
}
const fmtTime = (ts) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(ts);
const fmtDate = (ts) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(ts);
function relativeDay(ts) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff === -1) return 'Mañana';
  return fmtDate(ts);
}

/* ================================ Toasts ================================= */
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' toast--' + type : '');
  el.innerHTML = (type === 'ok' ? icon('check') : type === 'err' ? icon('x') : '') + `<span>${esc(msg)}</span>`;
  $('#toast-root').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2400);
  setTimeout(() => el.remove(), 2800);
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

/* ============================ Sincronización ============================ */
const POLL_MS = 60 * 1000; // Con la app visible, traer cambios de la pareja cada minuto.
let autoSyncTimer = null;
let pollTimer = null;
let syncing = null; // Promise de la sincronización en curso (evita solapes).

function scheduleAutoSync() {
  if (!state.settings.autoSync || !state.settings.syncUrl) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => doSync(true), 2500);
}
async function doSync(silent = false) {
  if (!state.settings.syncUrl) {
    if (!silent) toast('Configura la sincronización en Ajustes', 'err');
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
      // En segundo plano solo repintamos si llegó algo, para no cerrar
      // desplegables ni mover el scroll sin motivo.
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
const ptsText = (n) => (n === 1 ? '1 punto' : `${n} puntos`);
/* Los avisos no bloquean la interfaz: si falla la red se encolan solos. */
async function notifyTaskDone(task, memberId) {
  if (!task) return;
  const who = (await memberName(memberId)) || 'Alguien';
  notify({ message: `${who} ha completado «${task.name}» (+${ptsText(task.points)})`, tags: ['white_check_mark'] });
}
async function notifyTaskCreated(task) {
  const who = await memberName(state.settings.currentMemberId);
  const what = `«${task.name}» (${ptsText(task.points)})`;
  notify({ message: who ? `${who} ha creado la tarea ${what}` : `Nueva tarea: ${what}`, tags: ['heavy_plus_sign'] });
}
async function notifyTaskAssigned(task, memberId, weekKey, day) {
  if (!task) return;
  const who = (await memberName(memberId)) || 'sin asignar';
  const when = `${DAYS_LONG[day].toLowerCase()} ${dayDate(weekKey, day).getDate()}`;
  notify({ message: `Nueva tarea: «${task.name}» para ${who} el ${when}`, tags: ['spiral_calendar'] });
}

/* ============================== Router ================================== */
async function setView(v) {
  state.view = v;
  $$('.tabbar__item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === v));
  await refresh();
  view().scrollTo(0, 0);
  window.scrollTo(0, 0);
}
async function refresh() {
  const v = state.view;
  if (v === 'hoy') return renderHoy();
  if (v === 'semana') return renderSemana();
  if (v === 'tareas') return renderTareas();
  if (v === 'stats') return renderStats();
  if (v === 'ajustes') return renderAjustes();
}

/* ============================ Vista: HOY ================================ */
async function renderHoy() {
  const [members, tasks, logs, assigns] = await Promise.all([db.members(), db.tasks(), db.logs(), db.assignments()]);
  const today = new Date();
  const todayLogs = logs.filter((l) => isSameDay(l.ts, today)).sort((a, b) => b.ts - a.ts);
  const memById = new Map(members.map((m) => [m.id, m]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // Pendientes de hoy (según planificación semanal)
  const wk = weekKeyFromOffset(0);
  const todayDow = (today.getDay() + 6) % 7;
  const todayAssigns = assigns.filter((a) => a.weekKey === wk && a.day === todayDow);
  const pending = todayAssigns.filter((a) => !todayLogs.some((l) => l.taskId === a.taskId && l.memberId === a.memberId));

  const donePts = todayLogs.reduce((s, l) => s + (l.points || 0), 0);
  const greeting = (() => { const h = today.getHours(); return h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches'; })();

  let html = `
    <div class="card" style="background:linear-gradient(135deg, color-mix(in srgb,var(--accent) 22%,var(--bg-elev)), var(--bg-elev))">
      <div class="muted text-sm">${greeting} · ${esc(new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(today))}</div>
      <div class="flex gap-12" style="margin-top:10px;align-items:baseline">
        <div><span style="font-size:30px;font-weight:800">${todayLogs.length}</span> <span class="muted">tareas hoy</span></div>
        <div><span style="font-size:30px;font-weight:800">${donePts}</span> <span class="muted">puntos</span></div>
      </div>
    </div>`;

  if (members.length === 0) {
    html += emptyCard('users', 'Bienvenido', 'Empieza añadiendo a las personas del hogar en la pestaña <b>Tareas</b>.');
  }

  // Pendientes
  html += `<div class="section-title"><h2>Pendientes de hoy</h2></div>`;
  if (pending.length === 0) {
    html += `<div class="card empty"><span class="empty__emoji">${icon('sparkles')}</span>${todayAssigns.length ? '¡Todo hecho por hoy!' : 'No hay tareas planificadas para hoy.'}</div>`;
  } else {
    html += `<div class="card card--pad0"><div class="list">` + pending.map((a) => {
      const t = taskById.get(a.taskId), m = memById.get(a.memberId);
      if (!t) return '';
      return `<div class="assign-item">
        <span class="list-item__emoji">${taskIcon(t)}</span>
        <div class="list-item__body">
          <div class="list-item__title">${esc(t.name)}</div>
          <div class="list-item__sub">${m ? avatarChip(m) : '<span class="muted">Sin asignar</span>'}</div>
        </div>
        <button class="btn btn--primary btn--sm assign-item__done" data-done-assign="${a.id}">${icon('check')}Hecho</button>
      </div>`;
    }).join('') + `</div></div>`;
  }

  // Actividad de hoy
  html += `<div class="section-title"><h2>Actividad de hoy</h2></div>`;
  if (todayLogs.length === 0) {
    html += `<div class="card empty"><span class="empty__emoji">${icon('clipboard')}</span>Aún no has apuntado nada. Pulsa el botón <b>+</b>.</div>`;
  } else {
    html += `<div class="card card--pad0"><div class="list">` + todayLogs.map((l) => {
      const t = taskById.get(l.taskId), m = memById.get(l.memberId);
      return `<div class="list-item">
        <span class="list-item__emoji">${taskIcon(t)}</span>
        <div class="list-item__body">
          <div class="list-item__title">${t ? esc(t.name) : 'Tarea eliminada'}</div>
          <div class="list-item__sub">${m ? avatarChip(m) : '<span class="muted">?</span>'} · ${fmtTime(l.ts)}${l.points ? ` · <span class="badge badge--pts">${l.points} pts</span>` : ''}</div>
        </div>
        <button class="delete-x" data-del-log="${l.id}" aria-label="Borrar">${icon('x')}</button>
      </div>`;
    }).join('') + `</div></div>`;
  }

  html += `<button class="fab" id="fab-log" aria-label="Apuntar tarea realizada">${icon('plus')}</button>`;
  view().innerHTML = html;

  $('#fab-log').onclick = () => openLogModal();
  $$('[data-done-assign]').forEach((b) => b.onclick = async () => {
    const a = assigns.find((x) => x.id === b.dataset.doneAssign);
    const t = taskById.get(a.taskId);
    await db.logCompletion({ taskId: a.taskId, memberId: a.memberId, points: t ? t.points : 0 });
    toast('¡Hecho!', 'ok'); scheduleAutoSync(); notifyTaskDone(t, a.memberId); await renderHoy();
  });
  $$('[data-del-log]').forEach((b) => b.onclick = async () => {
    if (await confirmDialog('¿Borrar este registro?', { danger: true, okText: 'Borrar' })) {
      await db.deleteLog(b.dataset.delLog); scheduleAutoSync(); await renderHoy();
    }
  });
}

function avatarChip(m) {
  return `<span class="chip" style="padding-left:6px"><span class="avatar avatar--sm" style="background:${esc(m.color)}">${esc(initials(m.name))}</span>${esc(m.name)}</span>`;
}
function emptyCard(iconName, title, text) {
  return `<div class="card empty"><span class="empty__emoji">${icon(iconName)}</span><b>${esc(title)}</b><div style="margin-top:6px">${text}</div></div>`;
}

/* Modal: apuntar tarea realizada */
async function openLogModal(preTaskId) {
  const [members, tasks] = await Promise.all([db.members(), db.tasks()]);
  if (tasks.length === 0) { toast('Primero crea alguna tarea', 'err'); return setView('tareas'); }
  if (members.length === 0) { toast('Primero añade a una persona', 'err'); return setView('tareas'); }
  const cur = state.settings.currentMemberId || members[0].id;

  openModal('Apuntar tarea', `
    <div class="field">
      <label>¿Qué tarea?</label>
      <select class="select" id="log-task">
        ${tasks.map((t) => `<option value="${t.id}" ${t.id === preTaskId ? 'selected' : ''}>${esc(t.name)} (${t.points} pts)</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>¿Quién la hizo?</label>
      <div class="person-picker" id="log-person">
        ${members.map((m) => `<button type="button" class="person-pick ${m.id === cur ? 'is-active' : ''}" data-mid="${m.id}">
          <span class="avatar avatar--sm" style="background:${esc(m.color)}">${esc(initials(m.name))}</span>${esc(m.name)}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Nota (opcional)</label>
      <input class="input" id="log-note" placeholder="Ej: cocina y salón" maxlength="80">
    </div>
    <div class="modal__actions">
      <button class="btn btn--primary btn--block" id="log-save">Apuntar</button>
    </div>`, {
    onMount(modal) {
      let selMember = cur;
      $$('[data-mid]', modal).forEach((b) => b.onclick = () => {
        selMember = b.dataset.mid;
        $$('[data-mid]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
      });
      $('#log-save', modal).onclick = async () => {
        const taskId = $('#log-task', modal).value;
        const t = tasks.find((x) => x.id === taskId);
        await db.logCompletion({ taskId, memberId: selMember, points: t.points, note: $('#log-note', modal).value.trim() });
        await db.saveSettings({ currentMemberId: selMember });
        state.settings = await db.getSettings();
        closeModal(); toast('¡Apuntado!', 'ok'); scheduleAutoSync(); notifyTaskDone(t, selMember); await refresh();
      };
    }
  });
}

/* ============================ Vista: SEMANA ============================= */
async function renderSemana() {
  const [tasks, members, assigns, logs] = await Promise.all([db.tasks(), db.members(), db.assignments(), db.logs()]);
  const wk = weekKeyFromOffset(state.weekOffset);
  const weekStart = parseYmd(wk);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const memById = new Map(members.map((m) => [m.id, m]));
  const todayDow = state.weekOffset === 0 ? (new Date().getDay() + 6) % 7 : -1;

  const label = state.weekOffset === 0 ? 'Esta semana'
    : state.weekOffset === -1 ? 'Semana pasada'
    : state.weekOffset === 1 ? 'Próxima semana'
    : `${fmtDate(weekStart)} – ${fmtDate(weekEnd)}`;

  let html = `
    <div class="week-nav">
      <button class="icon-btn" data-week="-1" aria-label="Semana anterior">${icon('chevron-left')}</button>
      <div class="center"><h2>${esc(label)}</h2><div class="muted text-sm">${fmtDate(weekStart)} – ${fmtDate(weekEnd)}</div></div>
      <button class="icon-btn" data-week="1" aria-label="Semana siguiente">${icon('chevron-right')}</button>
    </div>`;
  if (state.weekOffset !== 0) html += `<div class="center" style="margin-bottom:12px"><button class="btn btn--ghost btn--sm" data-week="today">Volver a hoy</button></div>`;

  for (let d = 0; d < 7; d++) {
    const dayAssigns = assigns.filter((a) => a.weekKey === wk && a.day === d);
    const dd = dayDate(wk, d);
    html += `<div class="day-block card card--pad0">
      <div class="day-block__head" style="padding:12px 14px 8px">
        <h3>${DAYS_LONG[d]} ${d === todayDow ? '<span class="badge today-tag">HOY</span>' : ''} <span class="muted" style="font-weight:400">· ${dd.getDate()}</span></h3>
        <button class="btn btn--ghost btn--sm" data-add-assign="${d}">${icon('plus')}Añadir</button>
      </div>`;
    if (dayAssigns.length === 0) {
      html += `<div style="padding:0 14px 14px" class="muted text-sm">Sin tareas asignadas.</div>`;
    } else {
      html += dayAssigns.map((a) => {
        const t = taskById.get(a.taskId), m = memById.get(a.memberId);
        if (!t) return '';
        const done = logs.find((l) => l.taskId === a.taskId && l.memberId === a.memberId && isSameDay(l.ts, dd));
        return `<div class="assign-item">
          <span class="list-item__emoji">${taskIcon(t)}</span>
          <div class="list-item__body">
            <div class="list-item__title ${done ? 'list-item__title--strike' : ''}">${esc(t.name)}</div>
            <div class="list-item__sub">${m ? avatarChip(m) : '<span class="muted">Sin asignar</span>'}</div>
          </div>
          <button class="btn btn--sm ${done ? 'btn--ghost' : 'btn--primary'}" data-toggle-done="${a.id}" data-day="${d}" aria-label="${done ? 'Deshacer' : 'Hecho'}">${done ? icon('undo') + 'Deshacer' : icon('check')}</button>
          <button class="delete-x" data-del-assign="${a.id}" aria-label="Quitar">${icon('x')}</button>
        </div>`;
      }).join('');
    }
    html += `</div>`;
  }
  view().innerHTML = html;

  $$('[data-week]').forEach((b) => b.onclick = () => {
    const v = b.dataset.week;
    state.weekOffset = v === 'today' ? 0 : state.weekOffset + Number(v);
    renderSemana();
  });
  $$('[data-add-assign]').forEach((b) => b.onclick = () => openAssignModal(wk, Number(b.dataset.addAssign)));
  $$('[data-del-assign]').forEach((b) => b.onclick = async () => {
    if (await confirmDialog('¿Quitar esta asignación?', { danger: true, okText: 'Quitar' })) {
      await db.deleteAssignment(b.dataset.delAssign); scheduleAutoSync(); await renderSemana();
    }
  });
  $$('[data-toggle-done]').forEach((b) => b.onclick = async () => {
    const a = assigns.find((x) => x.id === b.dataset.toggleDone);
    const dd = dayDate(wk, Number(b.dataset.day));
    const t = taskById.get(a.taskId);
    const existing = logs.find((l) => l.taskId === a.taskId && l.memberId === a.memberId && isSameDay(l.ts, dd));
    if (existing) {
      await db.deleteLog(existing.id);
    } else {
      const ts = new Date(dd); ts.setHours(12, 0, 0, 0);
      await db.logCompletion({ taskId: a.taskId, memberId: a.memberId, points: t ? t.points : 0, ts: ts.getTime() });
      toast('¡Hecho!', 'ok');
      notifyTaskDone(t, a.memberId);
    }
    scheduleAutoSync(); await renderSemana();
  });
}

async function openAssignModal(weekKey, day) {
  const [tasks, members] = await Promise.all([db.tasks(), db.members()]);
  if (tasks.length === 0) { toast('Primero crea alguna tarea', 'err'); return setView('tareas'); }
  if (members.length === 0) { toast('Primero añade a una persona', 'err'); return setView('tareas'); }
  const cur = state.settings.currentMemberId || members[0].id;

  openModal(`Asignar · ${DAYS_LONG[day]}`, `
    <div class="field">
      <label>Tarea</label>
      <select class="select" id="as-task">
        ${tasks.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Asignar a</label>
      <div class="person-picker" id="as-person">
        ${members.map((m) => `<button type="button" class="person-pick ${m.id === cur ? 'is-active' : ''}" data-mid="${m.id}">
          <span class="avatar avatar--sm" style="background:${esc(m.color)}">${esc(initials(m.name))}</span>${esc(m.name)}</button>`).join('')}
      </div>
    </div>
    <div class="modal__actions"><button class="btn btn--primary btn--block" id="as-save">Asignar</button></div>`, {
    onMount(modal) {
      let sel = cur;
      $$('[data-mid]', modal).forEach((b) => b.onclick = () => { sel = b.dataset.mid; $$('[data-mid]', modal).forEach((x) => x.classList.toggle('is-active', x === b)); });
      $('#as-save', modal).onclick = async () => {
        const taskId = $('#as-task', modal).value;
        await db.addAssignment({ weekKey, day, taskId, memberId: sel });
        closeModal(); toast('Asignada', 'ok'); scheduleAutoSync();
        notifyTaskAssigned(tasks.find((t) => t.id === taskId), sel, weekKey, day);
        await renderSemana();
      };
    }
  });
}

/* ============================ Vista: TAREAS ============================= */
async function renderTareas() {
  const [members, tasks] = await Promise.all([db.members(), db.tasks()]);

  let html = `
    <div class="section-title"><h2>Personas</h2><button class="btn btn--sm btn--primary" id="add-member">${icon('plus')}Persona</button></div>`;
  if (members.length === 0) {
    html += `<div class="card empty"><span class="empty__emoji">${icon('users')}</span>Añade a las personas del hogar (tú, tu pareja, la familia…).</div>`;
  } else {
    html += `<div class="card card--pad0"><div class="list">` + members.map((m) => `
      <div class="list-item">
        <span class="avatar avatar--lg" style="background:${esc(m.color)}">${esc(initials(m.name))}</span>
        <div class="list-item__body"><div class="list-item__title">${esc(m.name)}</div></div>
        <button class="delete-x" data-del-member="${m.id}" aria-label="Borrar">${icon('x')}</button>
      </div>`).join('') + `</div></div>`;
  }

  html += `<hr class="divider">
    <div class="section-title"><h2>Catálogo de tareas</h2><button class="btn btn--sm btn--primary" id="add-task">${icon('plus')}Tarea</button></div>`;
  if (tasks.length === 0) {
    html += `<div class="card empty"><span class="empty__emoji">${icon('broom')}</span>Crea las tareas del hogar (fregar, aspiradora, baño…).</div>`;
  } else {
    html += `<div class="card card--pad0"><div class="list">` + tasks.map((t) => `
      <div class="list-item">
        <span class="list-item__emoji">${taskIcon(t)}</span>
        <div class="list-item__body"><div class="list-item__title">${esc(t.name)}</div>
          <div class="list-item__sub"><span class="badge badge--pts">${t.points} pts</span></div></div>
        <button class="delete-x" data-del-task="${t.id}" aria-label="Borrar">${icon('x')}</button>
      </div>`).join('') + `</div></div>`;
    html += `<p class="help">Los <b>puntos</b> reflejan el esfuerzo de cada tarea (p. ej. limpiar el baño vale más que sacar la basura). Se usan en las estadísticas.</p>`;
  }
  view().innerHTML = html;

  $('#add-member').onclick = () => openMemberModal();
  $('#add-task').onclick = () => openTaskModal();
  $$('[data-del-member]').forEach((b) => b.onclick = async () => {
    if (await confirmDialog('¿Eliminar a esta persona? Su historial se conserva en las estadísticas.', { danger: true, okText: 'Eliminar' })) {
      await db.deleteMember(b.dataset.delMember); scheduleAutoSync(); await renderTareas();
    }
  });
  $$('[data-del-task]').forEach((b) => b.onclick = async () => {
    if (await confirmDialog('¿Eliminar esta tarea del catálogo?', { danger: true, okText: 'Eliminar' })) {
      await db.deleteTask(b.dataset.delTask); scheduleAutoSync(); await renderTareas();
    }
  });
}

async function openMemberModal() {
  const used = (await db.members()).map((m) => m.color);
  const firstFree = MEMBER_COLORS.find((c) => !used.includes(c)) || MEMBER_COLORS[0];
  openModal('Nueva persona', `
    <div class="field"><label>Nombre</label><input class="input" id="m-name" placeholder="Ej: Ana" maxlength="30"></div>
    <div class="field"><label>Color</label>
      <div class="color-grid" id="m-color">
        ${MEMBER_COLORS.map((c) => `<button type="button" class="color-swatch ${c === firstFree ? 'is-active' : ''}" style="background:${c}" data-color="${c}"></button>`).join('')}
      </div>
    </div>
    <div class="modal__actions"><button class="btn btn--primary btn--block" id="m-save">Guardar</button></div>`, {
    onMount(modal) {
      let color = firstFree;
      $$('[data-color]', modal).forEach((b) => b.onclick = () => { color = b.dataset.color; $$('[data-color]', modal).forEach((x) => x.classList.toggle('is-active', x === b)); });
      $('#m-save', modal).onclick = async () => {
        const name = $('#m-name', modal).value.trim();
        if (!name) return toast('Escribe un nombre', 'err');
        await db.addMember({ name, color });
        closeModal(); toast('Persona añadida', 'ok'); scheduleAutoSync(); await renderTareas();
      };
    }
  });
}

async function openTaskModal() {
  openModal('Nueva tarea', `
    <div class="field"><label>Nombre</label><input class="input" id="t-name" placeholder="Ej: Fregar los platos" maxlength="40"></div>
    <div class="field"><label>Icono</label>
      <div class="icon-grid" id="t-icon">
        ${TASK_ICONS.map((k, i) => `<button type="button" class="${i === 0 ? 'is-active' : ''}" data-icon-pick="${k}" aria-label="${k}">${icon(k)}</button>`).join('')}
      </div>
    </div>
    <div class="field"><label>Esfuerzo (puntos)</label>
      <div class="segment segment--block" id="t-points">
        ${[1, 2, 3, 5].map((p, i) => `<button type="button" class="${i === 0 ? 'is-active' : ''}" data-pts="${p}">${p}</button>`).join('')}
      </div>
    </div>
    <div class="modal__actions"><button class="btn btn--primary btn--block" id="t-save">Guardar</button></div>`, {
    onMount(modal) {
      let iconName = TASK_ICONS[0], points = 1;
      $$('[data-icon-pick]', modal).forEach((b) => b.onclick = () => { iconName = b.dataset.iconPick; $$('[data-icon-pick]', modal).forEach((x) => x.classList.toggle('is-active', x === b)); });
      $$('[data-pts]', modal).forEach((b) => b.onclick = () => { points = Number(b.dataset.pts); $$('[data-pts]', modal).forEach((x) => x.classList.toggle('is-active', x === b)); });
      $('#t-save', modal).onclick = async () => {
        const name = $('#t-name', modal).value.trim();
        if (!name) return toast('Escribe un nombre', 'err');
        const task = await db.addTask({ name, icon: iconName, points });
        closeModal(); toast('Tarea creada', 'ok'); scheduleAutoSync(); notifyTaskCreated(task); await renderTareas();
      };
    }
  });
}

/* ============================= Vista: STATS ============================= */
async function renderStats() {
  const [members, tasks, logs] = await Promise.all([db.members(), db.tasks(), db.logs()]);
  const s = computeStats(logs, members, tasks, state.statsPeriod);
  const metric = state.statsMetric; // 'points' | 'count'
  const valKey = metric === 'points' ? 'points' : 'count';
  const pctKey = metric === 'points' ? 'pctPoints' : 'pctCount';
  const maxVal = Math.max(1, ...s.perMember.map((e) => e[valKey]));

  let html = `
    <div class="segment segment--block" id="stat-period">
      ${[['week', 'Semana'], ['month', 'Mes'], ['all', 'Total']].map(([k, l]) => `<button data-period="${k}" class="${state.statsPeriod === k ? 'is-active' : ''}">${l}</button>`).join('')}
    </div>
    <div class="stat-tiles">
      <div class="stat-tile"><div class="stat-tile__num">${s.totalCount}</div><div class="stat-tile__lbl">Tareas</div></div>
      <div class="stat-tile"><div class="stat-tile__num">${s.totalPoints}</div><div class="stat-tile__lbl">Puntos</div></div>
      <div class="stat-tile"><div class="stat-tile__num">${s.activeMembers}</div><div class="stat-tile__lbl">Personas</div></div>
    </div>`;

  if (s.totalCount === 0) {
    html += `<div class="card empty"><span class="empty__emoji">${icon('chart')}</span>No hay datos en este periodo.<div style="margin-top:6px">Apunta tareas desde la pestaña <b>Hoy</b>.</div></div>`;
    view().innerHTML = html;
    wireStatsControls();
    return;
  }

  // Métrica toggle
  html += `<div class="flex-between" style="margin:2px 2px 12px">
    <div class="muted text-sm">Reparto por ${metric === 'points' ? 'puntos' : 'nº de tareas'}</div>
    <div class="segment" id="stat-metric">
      <button data-metric="points" class="${metric === 'points' ? 'is-active' : ''}">Puntos</button>
      <button data-metric="count" class="${metric === 'count' ? 'is-active' : ''}">Nº</button>
    </div>
  </div>`;

  // Donut + leyenda
  const segs = donutSegments(s.perMember, valKey);
  html += `<div class="card"><div class="donut-wrap">
      <svg class="donut" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="46" fill="none" stroke="var(--bg-elev-2)" stroke-width="22"></circle>
        ${segs.map((g) => `<path d="${g.d}" fill="none" stroke="${esc(g.color)}" stroke-width="${g.sw}" stroke-linecap="butt"></path>`).join('')}
      </svg>
      <div class="donut-legend">
        ${s.perMember.filter((e) => e[valKey] > 0).map((e) => `
          <div class="donut-legend__item">
            <span class="chip__dot" style="background:${esc(e.member.color)}"></span>${esc(e.member.name)}
            <span class="pct">${e[pctKey]}%</span>
          </div>`).join('')}
      </div>
    </div></div>`;

  // Barras por persona
  html += `<div class="card"><div class="section-title mt-0"><h2>Por persona</h2></div>`;
  html += s.perMember.map((e) => `
    <div class="bar-row">
      <div class="bar-row__label"><span class="avatar avatar--sm" style="background:${esc(e.member.color)}">${esc(initials(e.member.name))}</span>${esc(e.member.name)}</div>
      <div class="bar-row__track"><div class="bar-row__fill" style="width:${Math.round((e[valKey] / maxVal) * 100)}%;background:${esc(e.member.color)}"></div></div>
      <div class="bar-row__val">${metric === 'points' ? e.points + ' pts' : e.count} · ${e[pctKey]}%</div>
    </div>`).join('') + `</div>`;

  // Ranking
  html += `<div class="card card--pad0"><div class="section-title" style="padding:14px 16px 6px;margin:0"><h2>Ranking</h2></div>`;
  html += s.perMember.map((e, i) => `
    <div class="ranking-item">
      <span class="ranking-item__pos ${i === 0 ? 'ranking-item__pos--1' : ''}">${i === 0 ? icon('trophy') : (i + 1)}</span>
      <span class="avatar" style="background:${esc(e.member.color)}">${esc(initials(e.member.name))}</span>
      <div class="list-item__body"><div class="list-item__title">${esc(e.member.name)}</div>
        <div class="list-item__sub">${e.count} tareas · ${e.points} puntos</div></div>
      <span class="badge">${e[pctKey]}%</span>
    </div>`).join('') + `</div>`;

  // Por tarea
  html += `<div class="card card--pad0"><div class="section-title" style="padding:14px 16px 6px;margin:0"><h2>Tareas más frecuentes</h2></div><div class="list">`;
  html += s.perTask.slice(0, 8).map((e) => `
    <div class="list-item">
      <span class="list-item__emoji">${taskIcon(e.task)}</span>
      <div class="list-item__body"><div class="list-item__title">${esc(e.task.name)}</div></div>
      <span class="badge">${e.count}×</span>
    </div>`).join('') + `</div></div>`;

  view().innerHTML = html;
  wireStatsControls();
}
function wireStatsControls() {
  $$('[data-period]').forEach((b) => b.onclick = () => { state.statsPeriod = b.dataset.period; renderStats(); });
  $$('[data-metric]').forEach((b) => b.onclick = () => { state.statsMetric = b.dataset.metric; renderStats(); });
}

/* ============================ Vista: AJUSTES ============================ */
async function renderAjustes() {
  const s = state.settings;
  const members = await db.members();
  const persist = await navigator.storage?.persisted?.().catch(() => false);
  const est = await db.storageEstimate();
  const usage = est ? `${(est.usage / 1024).toFixed(0)} KB usados` : '';
  const lastSync = s.lastSyncAt ? `${relativeDay(s.lastSyncAt)} ${fmtTime(s.lastSyncAt)}` : 'Nunca';
  const notifyOn = s.notifyEnabled && isValidTopic(s.ntfyTopic);

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
          ${ACCENTS.map((c) => `<button type="button" class="color-swatch ${c === s.accent ? 'is-active' : ''}" style="background:${c}" data-accent="${c}"></button>`).join('')}
        </div>
      </div>
    </div>

    <!-- Sincronización -->
    <div class="section-title"><h2>Sincronización familiar</h2></div>
    <div class="card">
      <div class="sync-status" style="margin-bottom:12px">
        <span class="sync-dot ${s.syncUrl ? 'sync-dot--ok' : 'sync-dot--off'}"></span>
        <span>${s.syncUrl ? 'Configurada' : 'Sin configurar'} · Última: ${esc(lastSync)}</span>
      </div>
      <div class="field"><label>URL del Web App (Google Apps Script)</label>
        <input class="input" id="set-url" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(s.syncUrl)}">
      </div>
      <div class="field"><label>Clave secreta (opcional)</label>
        <input class="input" id="set-secret" placeholder="Debe coincidir con SECRET del script" value="${esc(s.syncSecret)}">
      </div>
      <div class="field">
        <label class="flex-between" style="cursor:pointer">
          <span>Sincronizar automáticamente</span>
          <input type="checkbox" id="set-autosync" ${s.autoSync ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
        </label>
      </div>
      <div class="row" style="margin-bottom:10px">
        <button class="btn" id="btn-test">Probar</button>
        <button class="btn btn--primary" id="btn-savesync">Guardar y sincronizar</button>
      </div>
      <button class="btn btn--ghost btn--block btn--sm" id="btn-guide">${icon('book')}Cómo configurar Google Sheets</button>
    </div>

    <!-- Notificaciones (ntfy) -->
    <div class="section-title"><h2>Notificaciones</h2></div>
    <div class="card">
      <div class="sync-status" style="margin-bottom:12px">
        <span class="sync-dot ${notifyOn ? 'sync-dot--ok' : 'sync-dot--off'}"></span>
        <span>${notifyOn ? 'Activas · grupo «Tareas Hogar»' : 'Desactivadas'}</span>
      </div>
      <div class="field">
        <label class="flex-between" style="cursor:pointer">
          <span>Avisar al crear o completar tareas</span>
          <input type="checkbox" id="set-notify" ${s.notifyEnabled ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
        </label>
      </div>
      <div class="field"><label>Tema de ntfy (el mismo en todos los móviles)</label>
        <div class="input-group">
          <input class="input" id="set-topic" placeholder="tareas-hogar-xxxx" value="${esc(s.ntfyTopic)}" autocapitalize="off" autocomplete="off" spellcheck="false">
          <button class="btn" id="btn-topic-gen" title="Generar tema aleatorio" aria-label="Generar tema aleatorio">${icon('key')}</button>
        </div>
        <p class="help">Solo letras, números, «-» y «_». Quien conozca el tema puede leer los avisos: no lo publiques.</p>
      </div>
      <div class="field"><label>Servidor ntfy</label>
        <input class="input" id="set-ntfy-server" placeholder="https://ntfy.sh" value="${esc(s.ntfyServer)}" autocapitalize="off" spellcheck="false">
      </div>
      <div class="row" style="margin-bottom:10px">
        <button class="btn" id="btn-notify-test">${icon('send')}Probar</button>
        <button class="btn btn--primary" id="btn-notify-save">Guardar</button>
      </div>
      <button class="btn btn--ghost btn--block btn--sm" id="btn-notify-guide">${icon('bell')}Cómo recibirlas en el móvil</button>
    </div>

    <!-- Compartir configuración -->
    <div class="section-title"><h2>Compartir con tu pareja</h2></div>
    <div class="card">
      <p class="help mt-0" style="margin-bottom:12px">Envía la configuración de sincronización y notificaciones al otro móvil para no tener que copiarla a mano.</p>
      <button class="btn btn--primary btn--block" id="btn-share-setup" style="margin-bottom:12px">${icon('share')}Compartir configuración</button>
      <div class="field mb-0"><label>¿Te la han enviado? Pégala aquí</label>
        <div class="input-group">
          <input class="input" id="set-setup-code" placeholder="Enlace o código recibido" autocapitalize="off" autocomplete="off" spellcheck="false">
          <button class="btn" id="btn-setup-apply">Aplicar</button>
        </div>
      </div>
    </div>

    <!-- Persona de este dispositivo -->
    <div class="section-title"><h2>Este dispositivo</h2></div>
    <div class="card">
      <div class="field mb-0"><label>Yo soy…</label>
        <select class="select" id="set-me">
          <option value="">— Preguntar cada vez —</option>
          ${members.map((m) => `<option value="${m.id}" ${m.id === s.currentMemberId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
        </select>
        <p class="help">Se usa como valor por defecto al apuntar tareas y como autor en los avisos.</p>
      </div>
    </div>

    <!-- Almacenamiento -->
    <div class="section-title"><h2>Almacenamiento</h2></div>
    <div class="card">
      <div class="sync-status" style="margin-bottom:12px">
        <span class="sync-dot ${persist ? 'sync-dot--ok' : 'sync-dot--off'}"></span>
        <span>${persist ? 'Almacenamiento persistente activo' : 'Almacenamiento no persistente'} ${usage ? '· ' + usage : ''}</span>
      </div>
      ${persist ? '' : `<button class="btn btn--block btn--sm" id="btn-persist">Activar almacenamiento persistente</button>`}
    </div>

    <!-- Datos -->
    <div class="section-title"><h2>Datos (copia de seguridad)</h2></div>
    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <button class="btn btn--sm" id="btn-export">${icon('download')}Exportar</button>
        <button class="btn btn--sm" id="btn-import">${icon('upload')}Importar</button>
      </div>
      <button class="btn btn--danger btn--block btn--sm" id="btn-wipe">Borrar todos los datos</button>
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

  // --- Apariencia ---
  $$('[data-theme-btn]').forEach((b) => b.onclick = async () => {
    state.settings = await db.saveSettings({ theme: b.dataset.themeBtn });
    applyAppearance(); await renderAjustes();
  });
  $$('[data-accent]').forEach((b) => b.onclick = async () => {
    state.settings = await db.saveSettings({ accent: b.dataset.accent });
    applyAppearance(); await renderAjustes();
  });

  // --- Sincronización ---
  $('#btn-test').onclick = async () => {
    const url = $('#set-url').value.trim();
    if (!url) return toast('Introduce la URL', 'err');
    toast('Probando…');
    try { const r = await testConnection(url, $('#set-secret').value.trim()); toast(`Conexión OK · ${r.count} registros`, 'ok'); }
    catch (e) { toast('Error: ' + e.message, 'err'); }
  };
  $('#btn-savesync').onclick = async () => {
    state.settings = await db.saveSettings({
      syncUrl: $('#set-url').value.trim(),
      syncSecret: $('#set-secret').value.trim(),
      autoSync: $('#set-autosync').checked
    });
    await renderAjustes();
    await doSync(false);
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
    if ($('#set-topic').value.trim() && !await confirmDialog('Si cambias el tema tendréis que suscribiros de nuevo en la app ntfy. ¿Generar uno nuevo?', { okText: 'Generar' })) return;
    $('#set-topic').value = randomTopic();
  };
  $('#btn-notify-save').onclick = async () => {
    const f = readNotifyForm();
    if (f.notifyEnabled && !isValidTopic(f.ntfyTopic)) return toast('El tema no es válido', 'err');
    state.settings = await db.saveSettings(f);
    toast('Notificaciones guardadas', 'ok');
    await renderAjustes();
  };
  $('#btn-notify-test').onclick = async () => {
    const f = readNotifyForm();
    if (!isValidTopic(f.ntfyTopic)) return toast('Escribe o genera un tema', 'err');
    try { await testNotify(f.ntfyServer, f.ntfyTopic); toast('Aviso de prueba enviado', 'ok'); }
    catch (e) { toast('Error: ' + e.message, 'err'); }
  };
  $('#btn-notify-guide').onclick = () => openNotifyGuideModal(readNotifyForm());

  // --- Compartir configuración ---
  $('#btn-share-setup').onclick = shareSetup;
  $('#btn-setup-apply').onclick = async () => {
    const raw = $('#set-setup-code').value.trim();
    if (!raw) return toast('Pega el enlace o el código', 'err');
    await applySetup(raw);
  };

  // --- Este dispositivo ---
  $('#set-me').onchange = async (e) => { state.settings = await db.saveSettings({ currentMemberId: e.target.value || null }); };

  // --- Almacenamiento ---
  const persistBtn = $('#btn-persist');
  if (persistBtn) persistBtn.onclick = async () => {
    const r = await db.requestPersistentStorage();
    toast(r.persisted ? 'Persistencia activada' : 'El navegador no la concedió', r.persisted ? 'ok' : 'err');
    await renderAjustes();
  };

  // --- Datos ---
  $('#btn-export').onclick = exportData;
  $('#btn-import').onclick = () => $('#file-import').click();
  $('#file-import').onchange = importData;
  $('#btn-wipe').onclick = wipeData;
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
      <button class="btn btn--sm" id="gs-copy" style="position:absolute;top:8px;right:8px">Copiar</button>
    </div>
    <ol start="4" style="padding-left:20px;line-height:1.6;font-size:14px">
      <li>Pulsa <b>Implementar → Nueva implementación</b>.</li>
      <li>Tipo: <b>Aplicación web</b>. Ejecutar como: <b>Yo</b>. Con acceso: <b>Cualquier persona</b>.</li>
      <li>Copia la <b>URL</b> que termina en <code>/exec</code> y pégala arriba en la app.</li>
      <li>Comparte la misma URL con tu pareja/familia: al pegarla en su móvil verán los mismos datos.</li>
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
      </div>` : `<p class="help" style="margin:4px 0 12px">Primero escribe o genera un tema en Ajustes → Notificaciones y pulsa Guardar.</p>`}
    <ol start="3" style="padding-left:20px;line-height:1.6;font-size:14px">
      ${customServer ? `<li>Activa <b>Usar otro servidor</b> y escribe <code>${esc(ntfyServer)}</code>.</li>` : ''}
      <li>Si tu versión de ntfy lo permite, ponle como nombre visible <b>Tareas Hogar</b>.</li>
      <li>Repite lo mismo en el móvil de tu pareja (o usa <b>Compartir configuración</b>).</li>
      <li>Vuelve aquí, activa los avisos, pulsa <b>Guardar</b> y luego <b>Probar</b>.</li>
    </ol>
    <p class="help">Recibiréis un aviso cada vez que alguien cree una tarea (en el catálogo o en la semana) o la complete. Si no hay conexión, el aviso se envía al recuperarla.</p>
    ${topic ? `<p class="help">También puedes ver los avisos en el navegador: <a href="${esc(topicUrl(ntfyServer, topic))}" target="_blank" rel="noopener">${esc(topicUrl(ntfyServer, topic))}</a></p>` : ''}
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

/* ----------------------- Compartir configuración ------------------------ */
/* La configuración viaja en el hash de la URL (#setup=...), que el navegador
 * nunca envía al servidor. Contiene la URL de sync, la clave y el tema de
 * ntfy: compártela solo por un canal privado. */
function encodeSetup(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeSetup(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}
async function shareSetup() {
  const s = state.settings;
  if (!s.syncUrl && !isValidTopic(s.ntfyTopic)) return toast('Configura antes la sincronización o las notificaciones', 'err');
  const code = encodeSetup({ v: 1, syncUrl: s.syncUrl, syncSecret: s.syncSecret, ntfyServer: s.ntfyServer, ntfyTopic: s.ntfyTopic });
  const url = `${location.origin}${location.pathname}#setup=${code}`;
  const text = 'Configuración de Tareas Hogar. Ábrelo en el móvil o pégalo en Ajustes → Compartir con tu pareja:';
  if (navigator.share) {
    try { await navigator.share({ title: 'Tareas Hogar', text, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Enlace copiado: envíaselo a tu pareja', 'ok'); }
  catch { prompt('Copia este enlace y envíaselo a tu pareja:', url); }
}
async function applySetup(raw) {
  let cfg;
  try {
    const m = raw.match(/#setup=([-_A-Za-z0-9]+)/);
    cfg = decodeSetup(m ? m[1] : raw);
  } catch { return toast('Código no válido', 'err'); }
  if (!cfg || cfg.v !== 1) return toast('Código no válido', 'err');
  const parts = [cfg.syncUrl && 'sincronización con Google Sheets', isValidTopic(cfg.ntfyTopic) && 'notificaciones'].filter(Boolean);
  if (!parts.length) return toast('El código no trae configuración', 'err');
  if (!await confirmDialog(`Se aplicará la configuración de ${parts.join(' y ')} en este dispositivo. ¿Continuar?`, { okText: 'Aplicar' })) return;
  const patch = {};
  if (cfg.syncUrl) Object.assign(patch, { syncUrl: cfg.syncUrl, syncSecret: cfg.syncSecret || '', autoSync: true });
  if (isValidTopic(cfg.ntfyTopic)) Object.assign(patch, { ntfyTopic: cfg.ntfyTopic, ntfyServer: cfg.ntfyServer || 'https://ntfy.sh', notifyEnabled: true });
  state.settings = await db.saveSettings(patch);
  toast('Configuración aplicada', 'ok');
  if (state.view === 'ajustes') await renderAjustes();
  if (patch.syncUrl) await doSync(false);
  if (patch.ntfyTopic) openNotifyGuideModal(state.settings);
}
/* Si la app se abre con un enlace #setup=..., ofrecer aplicarlo. */
async function checkSetupLink() {
  if (!location.hash.startsWith('#setup=')) return;
  const raw = location.hash;
  history.replaceState(null, '', location.pathname + location.search);
  await applySetup(raw);
}

/* ------------------------------- Changelog ------------------------------ */
function openChangelogModal() {
  const typeLabel = { add: ['add', 'Nuevo'], chg: ['chg', 'Mejora'], fix: ['fix', 'Arreglo'] };
  const html = CHANGELOG.map((e) => `
    <div class="changelog-entry">
      <div class="changelog-entry__head">
        <span class="changelog-entry__ver">v${esc(e.version)}</span>
        <span class="changelog-entry__date">${esc(e.date)}</span>
      </div>
      <ul>${e.changes.map((c) => {
        const [cls, lbl] = typeLabel[c.type] || ['chg', 'Cambio'];
        return `<li><span class="tag-type tag-type--${cls}">${lbl}</span> ${esc(c.text)}</li>`;
      }).join('')}</ul>
    </div>`).join('');
  openModal('Novedades', html);
}

/* ----------------------- Exportar / importar / borrar ------------------- */
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
    await renderAjustes();
  } catch (err) { toast('Archivo no válido', 'err'); }
  e.target.value = '';
}
async function wipeData() {
  if (!await confirmDialog('Se borrarán TODAS las personas, tareas y registros de este dispositivo. Esta acción no se puede deshacer.', { danger: true, okText: 'Borrar todo' })) return;
  for (const s of db.DATA_STORES) await db.clearStore(s);
  toast('Datos borrados', 'ok');
  await setView('hoy');
}

/* ============================ Semilla inicial =========================== */
async function seedIfNeeded() {
  const seeded = await db.getOne('meta', 'seeded');
  if (seeded) return;
  const existing = await db.tasks();
  if (existing.length === 0) {
    for (const t of SEED_TASKS) await db.addTask(t);
  }
  await db.putRaw('meta', { key: 'seeded', value: true });
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

  await seedIfNeeded();

  // Iconos estáticos del shell (cabecera y barra inferior).
  $$('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

  // Cabecera
  $('#header-version').textContent = 'v' + APP_VERSION;
  $('#btn-sync').onclick = () => doSync(false);

  // Navegación
  $$('.tabbar__item').forEach((b) => b.onclick = () => setView(b.dataset.view));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  await setView('hoy');

  // Sincronización inicial y periódica en segundo plano (+ avisos pendientes).
  startBackgroundSync();
  await checkSetupLink();

  // Service Worker
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register(new URL('sw.js', window.location.href)); }
    catch (err) { console.warn('SW no registrado:', err); }
  }
}

init();
