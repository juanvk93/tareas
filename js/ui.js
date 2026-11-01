/* Utilidades de interfaz: DOM ($, $$, esc), formatos de fecha, toasts, modales, tema y cabecera. */
import { icon } from './icons.js';
import { ymd, parseYmd, todayKey, addDays } from './dates.js';
import { state, G } from './state.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const view = () => $('#view');

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

export function contrastColor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#111318' : '#ffffff';
}

export function startOfWeek(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}

export const fmtTime = (ts) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(ts);

export const fmtDate = (ts) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(ts);

export const fmtLongDate = (d) => new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);

export const fmtShortDay = (d) => new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(',', '');

export function relativeDay(ts) {
  const k = ymd(new Date(ts)), t = todayKey();
  if (k === t) return 'Hoy';
  if (k === addDays(t, -1)) return 'Ayer';
  return fmtDate(ts);
}

/** Etiqueta corta de un vencimiento 'YYYY-MM-DD'. */
export function dueLabel(key) {
  const t = todayKey();
  if (key === t) return 'Hoy';
  if (key === addDays(t, 1)) return 'Mañana';
  if (key === addDays(t, -1)) return 'Ayer';
  return fmtShortDay(parseYmd(key));
}

/** Para los avisos: "para hoy", "para mañana", "para el vie 31 oct". */
export function dueForText(key) {
  const l = dueLabel(key);
  if (l === 'Ayer') return 'de ayer';
  return l === 'Hoy' || l === 'Mañana' ? `para ${l.toLowerCase()}` : `para el ${l}`;
}

/** persist: no desaparece solo (se cierra con su acción). */
export function toast(msg, type = '', { action, persist = false } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' toast--' + type : '');
  el.innerHTML = (type === 'ok' ? icon('check') : type === 'err' ? icon('x') : '') + `<span>${esc(msg)}</span>`
    + (action ? `<button class="toast__action">${esc(action.label)}</button>` : '');
  if (action) $('.toast__action', el).onclick = () => { el.remove(); action.fn(); };
  $('#toast-root').appendChild(el);
  if (persist) return el;
  const life = action ? 4500 : 2400;
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, life);
  setTimeout(() => el.remove(), life + 400);
}

export function openModal(title, bodyHTML, { onMount, wide } = {}) {
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

export function closeModal() {
  const m = $('.modal-overlay');
  if (m) m.remove();
  document.body.style.overflow = '';
}

export function confirmDialog(message, { danger = false, okText = 'Aceptar' } = {}) {
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

export function applyAppearance() {
  const { accent, theme } = state.settings;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-contrast', contrastColor(accent));
  const bg = theme === 'light' ? '#f4f6fb' : '#0f1115';
  $('#meta-theme-color').setAttribute('content', bg);
}

export function applyShell() {
  const g = G();
  document.body.classList.toggle('no-group', !g);
  document.body.classList.toggle('is-personal', !!(g && g.personal));
  $('#header-title').textContent = g ? g.name : 'Tareas';
  $('#group-switch').disabled = !g;
  $('#group-switch-icon').innerHTML = g ? icon(g.personal ? 'lock' : 'users') : '';
  updateSyncBadge();
}

/** Punto rojo en el botón de sincronizar si el último intento del grupo activo falló. */
export function updateSyncBadge() {
  const g = G();
  const err = g && state.syncErrors[g.id];
  const btn = $('#btn-sync');
  btn.classList.toggle('has-error', !!err);
  btn.title = err ? `Sincronizar · el último intento falló: ${err}` : 'Sincronizar';
}

export function avatar(m, size = 'sm') {
  return `<span class="avatar avatar--${size}" style="background:${esc(m.color)};color:${contrastColor(m.color)}">${esc(initials(m.name))}</span>`;
}

export function emptyCard(iconName, html) {
  return `<div class="card empty"><span class="empty__emoji">${icon(iconName)}</span>${html}</div>`;
}

export const fab = (label) => `<button class="fab" id="fab-add" aria-label="${esc(label)}">${icon('plus')}</button>`;

/** Pequeño diálogo para pedir un texto. */
export function promptText(title, value, maxlength, onSave) {
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
