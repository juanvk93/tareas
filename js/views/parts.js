/* Piezas comunes de las vistas: filas de tarea, casillas y carga del catálogo del grupo. */
import * as db from '../db.js';
import { icon } from '../icons.js';
import { todayKey, isRepeating, todoRepeatLabel } from '../dates.js';
import { parseTask } from '../parse.js';
import { normalizeTitle } from '../catalog.js';
import { G, dueOf } from '../state.js';
import { $$, esc, fmtTime, relativeDay, dueLabel, avatar } from '../ui.js';
import { completeTodo, reopenTodo, resumeTask } from '../actions.js';
import { openTodoModal } from '../modals/todo.js';

export function todoRow(t, memById, { hideDate = false } = {}) {
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
  } else if (due === today && t.dueDate < today && !isRepeating(t.repeat)) {
    meta.push(`<span class="meta-item">${icon('history')}Desde ${esc(dueLabel(t.dueDate).toLowerCase())}</span>`); // Pasó a hoy.
  }
  const who = memById.get(t.assignee);
  if (who && !t.done) meta.push(`<span class="meta-item">${avatar(who, 'xs')}${esc(who.name)}</span>`);
  if (isRepeating(t.repeat)) meta.push(`<span class="meta-item">${icon('repeat')}${esc(todoRepeatLabel(t))}</span>`);
  if (!t.done && t.paused) meta.push(`<span class="meta-item meta-item--paused">${icon('pause')}En pausa</span>`);
  else if (!t.done && t.pausedUntil && t.pausedUntil > today) meta.push(`<span class="meta-item meta-item--paused">${icon('pause')}En pausa hasta ${esc(dueLabel(t.pausedUntil).toLowerCase())}</span>`);
  if (t.note) meta.push(`<span class="meta-item">${icon('note')}${esc(t.note)}</span>`);

  const check = t.projected
    ? `<span class="todo__check todo__check--projected" title="Repetición prevista">${icon('repeat')}</span>`
    : t.paused && !t.done
    ? `<button class="todo__check todo__check--paused" data-resume="${esc(t.id)}" aria-label="Reanudar">${icon('play')}</button>`
    : `<button class="todo__check" data-check="${esc(t.id)}" aria-label="${t.done ? 'Marcar como pendiente' : 'Marcar como resuelta'}">${icon('check')}</button>`;
  return `<div class="todo ${t.done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''} ${t.projected ? 'is-projected' : ''}">
    ${check}
    <div class="todo__body" data-open="${esc(t.id)}">
      <div class="todo__title">${icon(t.icon || 'sparkles')}<span>${esc(t.title)}</span></div>
      ${meta.length ? `<div class="todo__meta">${meta.join('')}</div>` : ''}
    </div>
  </div>`;
}

/** Lo que se ha entendido al escribir con naturalidad (parse.js) como chips.
 * removable: cada chip lleva data-ignore=<tipo> para descartarlo. */
export function parseChips(p, { removable = false } = {}) {
  const chip = (kind, ico, label) => `<${removable ? 'button type="button"' : 'span'} class="parse-chip" ${removable ? `data-ignore="${kind}" aria-label="Descartar ${esc(label)}"` : ''}>${icon(ico)}<span>${esc(label)}</span>${removable ? icon('x', { cls: 'parse-chip__x' }) : ''}</${removable ? 'button' : 'span'}>`;
  const out = [];
  if (p.dueDate) out.push(chip('date', 'calendar', dueLabel(p.dueDate)));
  if (p.repeat) out.push(chip('repeat', 'repeat', todoRepeatLabel(p)));
  if (p.assignee) out.push(chip('who', 'user', p.assigneeName));
  return out.join('');
}

/** parseTask con los miembros del grupo (para «para Ana»). */
export function parseWith(text, members, ignore) {
  return parseTask(text, { members: members.map((m) => ({ id: m.id, name: m.name })), ignore });
}

export function todoList(items, memById, opts) {
  return `<div class="card card--pad0">${items.map((t) => todoRow(t, memById, opts)).join('')}</div>`;
}

export function wireTodoRows(all) {
  $$('[data-check]').forEach((b) => b.onclick = () => {
    const t = all.find((x) => x.id === b.dataset.check);
    if (!t) return;
    t.done ? reopenTodo(t.id) : completeTodo(t.id);
  });
  $$('[data-resume]').forEach((b) => b.onclick = () => resumeTask(b.dataset.resume));
  $$('[data-open]').forEach((b) => b.onclick = () => openTodoModal({ todo: all.find((x) => x.id === b.dataset.open) }));
}

/* Inspirada en las listas de la compra tipo Bring: arriba las pendientes en
 * casillas de color (un toque = resuelta), debajo recientes y el catálogo del
 * grupo por categorías (un toque = pendiente para hoy). */
export function tile({ title, iconName, active, overdue, cls = '', extra = '', attrs = '' }) {
  return `<button class="tile ${active ? 'tile--active' : ''} ${overdue ? 'tile--overdue' : ''} ${cls}" ${attrs}>
    ${extra}
    <span class="tile__icon">${icon(iconName)}</span>
    <span class="tile__name">${esc(title)}</span>
  </button>`;
}

/** Datos del catálogo del grupo activo + títulos "recientes" (usados pero no guardados). */
export async function loadCatalog(all) {
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
