/* Utilidades de fechas y repetición de tareas. JS puro (sin DOM): se puede
 * importar en Node para probarlo.
 *
 * Las fechas de vencimiento se guardan como texto 'YYYY-MM-DD' en hora local,
 * así se comparan directamente como strings y no bailan con las zonas horarias.
 */

export function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseYmd(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function todayKey(now = new Date()) { return ymd(now); }
export function addDays(key, n) {
  const d = parseYmd(key);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function addMonths(key, n) {
  const d = parseYmd(key);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  // 31 de enero + 1 mes → 28/29 de febrero, no 3 de marzo.
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return ymd(d);
}

export const REPEATS = {
  none: 'No se repite',
  daily: 'Cada día',
  weekly: 'Cada semana',
  monthly: 'Cada mes'
};

function step(key, repeat) {
  if (repeat === 'daily') return addDays(key, 1);
  if (repeat === 'weekly') return addDays(key, 7);
  if (repeat === 'monthly') return addMonths(key, 1);
  return null;
}

/**
 * Siguiente vencimiento de una tarea repetida al resolverla: avanza desde su
 * fecha hasta la primera posterior a hoy (si llevaba días atrasada no se
 * generan copias de los días perdidos).
 */
export function nextDue(dueDate, repeat, today = todayKey()) {
  let next = step(dueDate, repeat);
  if (!next) return null;
  while (next <= today) next = step(next, repeat);
  return next;
}

/**
 * Ocurrencia vigente de una tarea: para las que se repiten, la última fecha de
 * la serie que no es posterior a hoy. Si la tarea va atrasada, las
 * repeticiones perdidas se agrupan en la más reciente (una tarea diaria
 * siempre es "de hoy"; una semanal solo va atrasada si ya pasó su día).
 * Sin repetición (o con fecha futura) es su propia fecha.
 */
export function currentDue(dueDate, repeat, today = todayKey()) {
  if (!repeat || repeat === 'none' || dueDate >= today) return dueDate;
  let cur = dueDate;
  for (let next = step(cur, repeat); next && next <= today; next = step(cur, repeat)) cur = next;
  return cur;
}

/** Diferencia en días naturales entre dos claves (b - a). */
export function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}
