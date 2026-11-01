/* Vista Hechas: historial y resumen semanal por persona. */
import * as db from '../db.js';
import { KEEP_DONE_DAYS } from '../db.js';
import { ymd, parseYmd, todayKey, addDays } from '../dates.js';
import { G } from '../state.js';
import { view, esc, startOfWeek, fmtLongDate, avatar, emptyCard } from '../ui.js';
import { todoList, wireTodoRows } from './parts.js';

export async function renderHechas() {
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
    html += `<p class="help center">Se guardan los últimos ${KEEP_DONE_DAYS} días${G().syncUrl ? ' (lo anterior queda en la pestaña «archivo» de la hoja)' : ''}.</p>`;
  }
  view().innerHTML = html;
  wireTodoRows(all);
}
