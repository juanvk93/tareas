/* Acciones sobre tareas que comparten varias vistas (resolver, deshacer) y avisos por ntfy. */
import * as db from './db.js';
import { notify, recipientsOf, splitAssignee } from './notify.js';
import { todayKey, isRepeating, todoRepeatLabel } from './dates.js';
import { normalizeTitle } from './catalog.js';
import { G } from './state.js';
import { dueLabel, dueForText, toast } from './ui.js';
import { scheduleAutoSync } from './sync-ui.js';
import { refreshKeepingScroll } from './nav.js';

export async function memberName(id) {
  if (!id) return null;
  const m = await db.getOne('members', id);
  return m && !m.deleted ? m.name : null;
}

/* Los avisos van al tema de cada uno de los DEMÁS miembros (nadie recibe los
 * suyos) y no bloquean la interfaz: si falla la red se encolan solos.
 * En un grupo privado no hay a quién avisar. */
async function othersOf(g) {
  return recipientsOf(g, await db.members(g.id), g.currentMemberId);
}
async function notifyOthers(n) {
  const g = G();
  const to = await othersOf(g);
  if (to.length) await notify(g, to, n);
}

/** «Juan te ha asignado «Sacar la basura» para mañana (cada semana)» */
function assignedMessage(who, todo) {
  const rep = isRepeating(todo.repeat) ? ` (${todoRepeatLabel(todo).toLowerCase()})` : '';
  return `${who} te ha asignado «${todo.title}» ${dueForText(todo.dueDate)}${rep}`;
}

/* Al añadir: quien tiene asignada la tarea recibe «te ha asignado»; el resto, el aviso normal. */
export async function notifyCreated(todo) {
  const g = G();
  const who = (await memberName(g.currentMemberId)) || 'Alguien';
  const { assignee, rest } = splitAssignee(await othersOf(g), todo.assignee);
  if (assignee) notify(g, [assignee], { message: assignedMessage(who, todo), tags: ['point_right'] });
  const forWhom = todo.assignee ? ` (le toca a ${(await memberName(todo.assignee)) || '?'})` : '';
  if (rest.length) notify(g, rest, { message: `${who} ha añadido «${todo.title}» ${dueForText(todo.dueDate)}${forWhom}`, tags: ['heavy_plus_sign'] });
}

/* Al editar y cambiar «¿A quién le toca?» a otra persona: solo a ella. */
export async function notifyAssigned(todo) {
  const g = G();
  const { assignee } = splitAssignee(await othersOf(g), todo.assignee);
  if (!assignee) return;
  const who = (await memberName(g.currentMemberId)) || 'Alguien';
  notify(g, [assignee], { message: assignedMessage(who, todo), tags: ['point_right'] });
}

export async function notifyResolved(todo) {
  const g = G();
  const who = (await memberName(g.currentMemberId)) || 'Alguien';
  notifyOthers({ message: `${who} ha resuelto «${todo.title}»`, tags: ['white_check_mark'] });
}

/**
 * Lanza una rutina: añade para hoy las tareas que aún no estén pendientes y
 * manda un solo aviso («Juan ha añadido «Limpieza del sábado» (5 tareas)»).
 */
export async function runRoutine(routine) {
  const g = G();
  const today = todayKey();
  const pending = new Set((await db.todos(g.id)).filter((t) => !t.done && !t.paused && t.dueDate <= today).map((t) => normalizeTitle(t.title)));
  const created = [];
  for (const it of routine.items) {
    if (pending.has(normalizeTitle(it.title))) continue;
    pending.add(normalizeTitle(it.title));
    created.push(await db.addTodo({ groupId: g.id, title: it.title, icon: it.icon, dueDate: today, createdBy: g.currentMemberId }));
  }
  if (!created.length) { toast(`Todas las tareas de «${routine.name}» ya están pendientes`); return; }
  scheduleAutoSync();
  const who = (await memberName(g.currentMemberId)) || 'Alguien';
  const n = created.length;
  notifyOthers({ message: `${who} ha añadido «${routine.name}» (${n} ${n === 1 ? 'tarea' : 'tareas'})`, tags: ['heavy_plus_sign'] });
  toast(`«${routine.name}»: ${n} ${n === 1 ? 'tarea añadida' : 'tareas añadidas'}`, 'ok', {
    action: { label: 'Deshacer', fn: async () => { for (const t of created) await db.deleteTodo(t.id); scheduleAutoSync(); await refreshKeepingScroll(); } }
  });
  await refreshKeepingScroll();
}

/** Pospone una tarea a `newDate` (solo esta vez si se repite). */
export async function postponeTask(id, newDate) {
  const { todo, undo } = await db.postponeTodo(id, newDate);
  if (!todo) return;
  scheduleAutoSync();
  toast(`Pospuesta a ${dueLabel(newDate).toLowerCase()}`, 'ok', {
    action: { label: 'Deshacer', fn: async () => { await db.updateTodo(id, undo); scheduleAutoSync(); await refreshKeepingScroll(); } }
  });
  await refreshKeepingScroll();
}

/** Pausa una tarea repetida (until = 'YYYY-MM-DD' o null = hasta que se reanude). */
export async function pauseTask(id, until = null) {
  const t = await db.pauseTodo(id, until);
  if (!t) return;
  scheduleAutoSync();
  toast(until ? `En pausa · vuelve ${dueLabel(t.dueDate).toLowerCase()}` : 'En pausa hasta que la reanudes', 'ok', {
    action: { label: 'Deshacer', fn: () => resumeTask(id, true) }
  });
  await refreshKeepingScroll();
}
export async function resumeTask(id, quiet = false) {
  const t = await db.resumeTodo(id);
  if (!t) return;
  scheduleAutoSync();
  if (!quiet) toast(`Reanudada · ${dueLabel(t.dueDate).toLowerCase()}`, 'ok');
  await refreshKeepingScroll();
}

export async function completeTodo(id) {
  const { todo, next } = await db.completeTodo(id, G().currentMemberId);
  if (!todo) return;
  scheduleAutoSync();
  notifyResolved(todo);
  toast(next ? `Resuelta · vuelve ${dueLabel(next.dueDate).toLowerCase()}` : 'Resuelta', 'ok', {
    action: { label: 'Deshacer', fn: () => reopenTodo(id, true) }
  });
  await refreshKeepingScroll();
}

export async function reopenTodo(id, quiet = false) {
  await db.reopenTodo(id);
  scheduleAutoSync();
  if (!quiet) toast('Vuelve a estar pendiente');
  await refreshKeepingScroll();
}
