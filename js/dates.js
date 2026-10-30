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

/* Repetición = texto '<N><unidad>' con unidad d (días), w (semanas), m (meses)
 * o y (años): '1d' cada día, '2w' cada 2 semanas, '6m' cada 6 meses…
 * 'none' (o vacío) = no se repite. daily/weekly/monthly se aceptan como alias. */
const ALIASES = { daily: '1d', weekly: '1w', monthly: '1m', yearly: '1y' };
const UNITS = { d: ['día', 'días'], w: ['semana', 'semanas'], m: ['mes', 'meses'], y: ['año', 'años'] };
export const REPEAT_UNITS = Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [k, v[1]]));

/** { n, unit } de una repetición, o null si no se repite. */
export function parseRepeat(repeat) {
  const m = /^(\d{1,3})([dwmy])$/.exec(ALIASES[repeat] || repeat || '');
  return m && Number(m[1]) > 0 ? { n: Number(m[1]), unit: m[2] } : null;
}
export const isRepeating = (repeat) => !!parseRepeat(repeat);
/** Forma canónica ('weekly' → '1w'); 'none' si no se repite. */
export function normalizeRepeat(repeat) {
  const p = parseRepeat(repeat);
  return p ? `${p.n}${p.unit}` : 'none';
}
export function repeatLabel(repeat) {
  const p = parseRepeat(repeat);
  if (!p) return 'No se repite';
  return p.n === 1 ? `Cada ${UNITS[p.unit][0]}` : `Cada ${p.n} ${UNITS[p.unit][1]}`;
}
/** Opciones rápidas del selector (el resto, con «Personalizado»). */
export const REPEAT_PRESETS = ['none', '1d', '1w', '2w', '3w', '1m', '2m', '3m', '6m', '1y'];

function step(key, repeat) {
  const p = parseRepeat(repeat);
  if (!p) return null;
  if (p.unit === 'd') return addDays(key, p.n);
  if (p.unit === 'w') return addDays(key, 7 * p.n);
  if (p.unit === 'm') return addMonths(key, p.n);
  return addMonths(key, 12 * p.n);
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
  if (!isRepeating(repeat) || dueDate >= today) return dueDate;
  let cur = dueDate;
  for (let next = step(cur, repeat); next && next <= today; next = step(cur, repeat)) cur = next;
  return cur;
}

/** Diferencia en días naturales entre dos claves (b - a). */
export function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}
