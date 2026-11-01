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
 * Con semanas se pueden indicar días concretos (ISO: 1 = lunes … 7 = domingo):
 * '1w:1,4' lunes y jueves, '2w:6' sábados alternos.
 * 'none' (o vacío) = no se repite. daily/weekly/monthly se aceptan como alias. */
const ALIASES = { daily: '1d', weekly: '1w', monthly: '1m', yearly: '1y' };
const UNITS = { d: ['día', 'días'], w: ['semana', 'semanas'], m: ['mes', 'meses'], y: ['año', 'años'] };
export const REPEAT_UNITS = Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [k, v[1]]));
/** Días de la semana (índice 0 = lunes). */
export const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
export const WEEKDAYS_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const WEEKDAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** Día de la semana ISO de una fecha: 1 = lunes … 7 = domingo. */
export function isoDay(key) {
  return ((parseYmd(key).getDay() + 6) % 7) + 1;
}

/** { n, unit, days? } de una repetición, o null si no se repite. */
export function parseRepeat(repeat) {
  const m = /^(\d{1,3})([dwmy])(?::([1-7](?:,[1-7])*))?$/.exec(ALIASES[repeat] || repeat || '');
  if (!m || Number(m[1]) <= 0 || (m[3] && m[2] !== 'w')) return null;
  const p = { n: Number(m[1]), unit: m[2] };
  if (m[3]) p.days = [...new Set(m[3].split(',').map(Number))].sort((a, b) => a - b);
  return p;
}
export const isRepeating = (repeat) => !!parseRepeat(repeat);
/** Forma canónica ('weekly' → '1w', '1w:4,1' → '1w:1,4'); 'none' si no se repite.
 * Todos los días de la semana, cada semana, es lo mismo que «cada día». */
export function normalizeRepeat(repeat) {
  const p = parseRepeat(repeat);
  if (!p) return 'none';
  if (!p.days) return `${p.n}${p.unit}`;
  if (p.n === 1 && p.days.length === 7) return '1d';
  return `${p.n}w:${p.days.join(',')}`;
}

/** «lun, mié y vie» */
function listDays(days, names = WEEKDAYS_SHORT) {
  const n = days.map((d) => names[d - 1]);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}` : n[0];
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function repeatLabel(repeat) {
  const p = parseRepeat(repeat);
  if (!p) return 'No se repite';
  if (p.days) {
    const key = p.days.join(',');
    if (p.n === 1) {
      if (key === '1,2,3,4,5') return 'Entre semana';
      if (key === '6,7') return 'Fines de semana';
      if (p.days.length === 1) return `Cada ${WEEKDAYS[p.days[0] - 1]}`;
      return cap(listDays(p.days, p.days.length === 2 ? WEEKDAYS : WEEKDAYS_SHORT));
    }
    return `Cada ${p.n} semanas: ${listDays(p.days)}`;
  }
  return p.n === 1 ? `Cada ${UNITS[p.unit][0]}` : `Cada ${p.n} ${UNITS[p.unit][1]}`;
}
/** Opciones rápidas del selector (el resto, con «Días de la semana» o «Personalizado»). */
export const REPEAT_PRESETS = ['none', '1d', '1w', '2w', '3w', '1m', '2m', '3m', '6m', '1y'];

function step(key, repeat) {
  const p = parseRepeat(repeat);
  if (!p) return null;
  if (p.days) {
    // El siguiente día marcado de esta semana o, si no quedan, el primero de
    // la semana N siguiente (cuenta desde la semana de la fecha actual).
    const d = isoDay(key);
    const later = p.days.find((x) => x > d);
    if (later) return addDays(key, later - d);
    return addDays(key, 7 * p.n - (d - p.days[0]));
  }
  if (p.unit === 'd') return addDays(key, p.n);
  if (p.unit === 'w') return addDays(key, 7 * p.n);
  if (p.unit === 'm') return addMonths(key, p.n);
  return addMonths(key, 12 * p.n);
}

/** Primera fecha de la serie a partir de la elegida: con días de la semana,
 * si la elegida no es uno de ellos, el siguiente día marcado. */
export function alignDue(dueDate, repeat) {
  const p = parseRepeat(repeat);
  if (!p || !p.days || p.days.includes(isoDay(dueDate))) return dueDate;
  const d = isoDay(dueDate);
  const later = p.days.find((x) => x > d);
  return addDays(dueDate, later ? later - d : 7 - d + p.days[0]);
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

/* ---- Tareas que cuentan desde el día en que se hacen (repeatFrom: 'done') ----
 * «Limpiar filtros cada 10 días»: la siguiente es el día en que se resuelve +
 * el intervalo. Hasta entonces no hay calendario que seguir, así que no se
 * agrupan repeticiones perdidas ni se proyectan en Próximas. */

/** ¿Cuenta desde el día en que se hace? (solo intervalos, no días de la semana) */
export function countsFromDone(t) {
  const p = parseRepeat(t.repeat);
  return !!p && !p.days && t.repeatFrom === 'done';
}

/** Fecha vigente de una tarea (ver currentDue); las «desde que se hace», su fecha tal cual. */
export function todoDue(t, today = todayKey()) {
  if (countsFromDone(t)) return t.dueDate;
  if (t.seriesDue && isRepeating(t.repeat)) {
    // Pospuesta: manda la fecha a la que se movió mientras no haya pasado; si
    // pasó sin hacerla y la serie ya va por una repetición posterior, esa.
    if (t.dueDate >= today) return t.dueDate;
    const series = currentDue(t.seriesDue, t.repeat, today);
    return series > t.dueDate ? series : t.dueDate;
  }
  return currentDue(t.dueDate, t.repeat, today);
}

/** Fecha de la serie de la que parte el calendario (la original si se pospuso). */
export function seriesBase(t) {
  return t.seriesDue || t.dueDate;
}

/** Siguiente fecha al resolver una tarea el día `doneDay`. */
export function nextDueOnComplete(t, doneDay = todayKey()) {
  if (!isRepeating(t.repeat)) return null;
  if (countsFromDone(t)) return step(doneDay, t.repeat);
  // Si se pospuso, la siguiente sigue el calendario de la serie y es posterior a la pospuesta.
  return nextDue(seriesBase(t), t.repeat, t.dueDate > doneDay ? t.dueDate : doneDay);
}

/** Etiqueta de la repetición de una tarea: «Cada 10 días desde la última vez». */
export function todoRepeatLabel(t) {
  return repeatLabel(t.repeat) + (countsFromDone(t) ? ' desde la última vez' : '');
}

/* ---- Posponer ----
 * Mueve solo esta vez. En una tarea repetida con calendario se guarda
 * seriesDue (la fecha de la serie que le tocaba) y la siguiente se calcula
 * desde ella: posponer el lunes al martes no mueve los lunes siguientes. */

/** Cambios para posponer una tarea a `newDate` ('YYYY-MM-DD'). */
export function postponePatch(t, newDate, today = todayKey()) {
  const patch = { dueDate: newDate };
  if (isRepeating(t.repeat) && !countsFromDone(t)) {
    // La repetición que representa ahora (si iba atrasada, la vigente de la serie).
    patch.seriesDue = currentDue(seriesBase(t), t.repeat, today);
  }
  return patch;
}

/* ---- Pausa (vacaciones) ----
 * Pausar hasta una fecha = mover la tarea a su primera repetición desde esa
 * fecha (así deja de salir en Hoy sin lógica extra) y guardar pausedUntil para
 * la etiqueta y pausedDue (fecha original) por si se reanuda antes.
 * Pausar sin fecha = paused: true (no sale en Hoy ni se proyecta). */

/** Primera fecha de la serie que no es anterior a `fromDay`. */
export function resumeDue(t, fromDay) {
  if (t.dueDate >= fromDay) return t.dueDate;
  if (!isRepeating(t.repeat) || countsFromDone(t)) return fromDay;
  return nextDue(t.dueDate, t.repeat, addDays(fromDay, -1));
}

/** ¿Está en pausa ahora? (sin fecha, o con fecha que aún no ha llegado) */
export function isPaused(t, today = todayKey()) {
  return !!t.paused || (!!t.pausedUntil && t.pausedUntil > today);
}

/** Diferencia en días naturales entre dos claves (b - a). */
export function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}
