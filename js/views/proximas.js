/* Vista Próximas: tareas con fecha futura y repeticiones previstas. */
import * as db from '../db.js';
import { icon } from '../icons.js';
import { parseYmd, todayKey, addDays, nextDue, currentDue, isRepeating, countsFromDone, seriesBase } from '../dates.js';
import { G } from '../state.js';
import { $, view, esc, fmtLongDate, fmtShortDay, emptyCard, fab } from '../ui.js';
import { todoList, wireTodoRows } from './parts.js';
import { openTodoModal } from '../modals/todo.js';

export const PROJECT_DAYS = 28;   // Horizonte de las repeticiones previstas.

export const PROJECT_MAX = 6;     // Máximo de repeticiones previstas por tarea.

/** Repeticiones futuras de las tareas que se repiten. Solo se muestran: la
 * tarea real de la siguiente fecha se crea al resolver la actual. */
export function projectRepeats(pending, today) {
  const out = [];
  const limit = addDays(today, PROJECT_DAYS);
  const real = new Set(pending.map((t) => `${t.seriesId || t.id}@${t.dueDate}`));
  for (const t of pending) {
    if (!isRepeating(t.repeat) || countsFromDone(t)) continue; // «Desde que se hace»: no hay calendario.
    // Desde el calendario de la serie (si se pospuso, la original) y después de la real.
    let due = currentDue(seriesBase(t), t.repeat, today);
    const after = t.dueDate > today ? t.dueDate : today;
    for (let n = 0; n < PROJECT_MAX;) {
      due = nextDue(due, t.repeat, due);
      if (due > limit) break;
      if (due <= after || real.has(`${t.seriesId || t.id}@${due}`)) continue;
      out.push({ ...t, dueDate: due, projected: true });
      n++;
    }
  }
  return out;
}

export async function renderProximas() {
  const [members, all] = await Promise.all([db.members(G().id), db.todos(G().id)]);
  const memById = new Map(members.map((m) => [m.id, m]));
  const today = todayKey();
  const open = all.filter((t) => !t.done && !t.paused);
  const paused = all.filter((t) => !t.done && t.paused).sort((a, b) => a.title.localeCompare(b.title));
  const upcoming = [...open.filter((t) => t.dueDate > today), ...projectRepeats(open, today)]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.projected ? 1 : 0) - (b.projected ? 1 : 0) || a.createdAt - b.createdAt);

  let html = '';
  if (!upcoming.length && !paused.length) {
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
  if (paused.length) {
    html += `<div class="section-title"><h2>En pausa</h2></div>` + todoList(paused, memById, { hideDate: true })
      + `<p class="help center">${icon('play')} Toca el botón de reproducir para reanudar una tarea.</p>`;
  }
  html += fab('Planificar tarea');
  view().innerHTML = html;
  wireTodoRows(all);
  $('#fab-add').onclick = () => openTodoModal({ dueDate: addDays(today, 1), when: 'date' });
}
