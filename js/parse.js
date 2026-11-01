/* Añadir escribiendo con naturalidad: «Sacar el vidrio el viernes cada 2 semanas»
 * → { title: 'Sacar el vidrio', dueDate: <viernes>, repeat: '2w' }.
 * JS puro (sin DOM): se prueba en Node (tools/test.mjs).
 *
 * Entiende fechas (hoy, mañana, pasado mañana, el viernes, el 15 (de noviembre),
 * 15/11, dentro de 3 días, la semana que viene, el fin de semana), repeticiones
 * (cada día, cada 2 semanas, cada 10 días, los lunes y jueves, entre semana,
 * los fines de semana, el 1 de cada mes…), «desde que se haga» y «para Ana».
 */
import { todayKey, addDays, parseYmd, ymd, isoDay, normalizeRepeat } from './dates.js';

const WD = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabados?', 'domingos?'];
const WD_RE = `(?:${WD.join('|')})`;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre|setiembre|sept', 'octubre', 'noviembre', 'diciembre'];
const MONTH_RE = `(?:${MONTHS.join('|')})`;
const NUM_WORDS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30 };
const NUM_RE = `(?:\\d{1,3}|${Object.keys(NUM_WORDS).join('|')})`;
const UNIT = { dia: 'd', dias: 'd', semana: 'w', semanas: 'w', mes: 'm', meses: 'm', ano: 'y', anos: 'y' };
const UNIT_RE = '(?:dias?|semanas?|mes(?:es)?|anos?)';

const num = (s) => NUM_WORDS[s] ?? Number(s);
const weekdayIndex = (w) => WD.findIndex((p) => new RegExp(`^${p}$`).test(w)) + 1;
const daysIn = (s) => [...new Set(s.match(new RegExp(WD_RE, 'g')).map(weekdayIndex))].sort((a, b) => a - b);

/** Minúsculas y sin tildes, carácter a carácter (misma longitud que el original). */
function fold(text) {
  return text.split('').map((c) => (c.normalize('NFD')[0] || c).toLowerCase()).join('');
}

/** Próximo día de la semana `iso` estrictamente posterior a `today`. */
function nextWeekday(today, iso) {
  const d = isoDay(today);
  return addDays(today, ((iso - d + 6) % 7) + 1);
}
/** Día `n` del mes: este mes si aún no ha pasado; si no, el siguiente. */
function nextDayOfMonth(today, n) {
  const t = parseYmd(today);
  for (let k = 0; k < 2; k++) {
    const last = new Date(t.getFullYear(), t.getMonth() + k + 1, 0).getDate();
    const key = ymd(new Date(t.getFullYear(), t.getMonth() + k, Math.min(n, last)));
    if (key >= today) return key;
  }
  return null;
}
/** Día y mes (y año opcional): el próximo que no haya pasado. */
function dateOf(today, day, month, year) {
  const t = parseYmd(today);
  const y = year ? (year < 100 ? 2000 + year : year) : t.getFullYear();
  const d = new Date(y, month - 1, day);
  if (d.getMonth() !== month - 1) return null; // 31 de febrero…
  let key = ymd(d);
  if (!year && key < today) key = ymd(new Date(y + 1, month - 1, day));
  return key;
}
const monthIndex = (m) => MONTHS.findIndex((p) => new RegExp(`^(?:${p})$`).test(m)) + 1;

/* Reglas en orden de prioridad. Cada una: [tipo, patrón, (match, ctx) => valores | null].
 * Los patrones se aplican sobre el texto sin tildes y en minúsculas. */
const RULES = [
  // --- Repeticiones (antes que las fechas: «los lunes» no es «el lunes») ---
  ['repeat', `(?:el )?(?:dia )?(\\d{1,2}) de cada mes`, (m, c) => ({ repeat: '1m', dueDate: nextDayOfMonth(c.today, Number(m[1])) })],
  ['repeat', `(?:cada dia|todos los dias|a diario|diariamente)`, () => ({ repeat: '1d' })],
  ['repeat', `(?:entre semana|de lunes a viernes|(?:los )?dias laborables)`, () => ({ repeat: '1w:1,2,3,4,5' })],
  ['repeat', `(?:(?:todos )?los fines de semana|cada fin de semana)`, () => ({ repeat: '1w:6,7' })],
  ['repeat', `(?:cada|todos los|los) ${WD_RE}(?:(?:, ?| y | e )${WD_RE})*`, (m) => ({ days: daysIn(m[0]) })],
  // Varios días seguidos sin «los» («lunes, miércoles y viernes») también es repetición.
  ['repeat', `${WD_RE}(?:(?:, ?| y | e )${WD_RE})+`, (m) => ({ days: daysIn(m[0]) })],
  ['repeat', `cada quincena|quincenalmente`, () => ({ n: 2, unit: 'w' })],
  ['repeat', `cada (${NUM_RE}) ${UNIT_RE}`, (m) => ({ n: num(m[1]), unit: UNIT[m[0].split(' ').pop()] })],
  ['repeat', `cada (semana|mes|ano)|(semanal|mensual|anual)mente`, (m) => ({ n: 1, unit: { semana: 'w', mes: 'm', ano: 'y', semanal: 'w', mensual: 'm', anual: 'y' }[m[1] || m[2]] })],
  ['from', `desde (?:que (?:se |lo |la )?haga|la ultima vez)`, () => ({ repeatFrom: 'done' })],
  // --- Fechas ---
  ['date', `pasado manana`, (m, c) => ({ dueDate: addDays(c.today, 2) })],
  ['date', `manana`, (m, c) => ({ dueDate: addDays(c.today, 1) })],
  ['date', `hoy`, (m, c) => ({ dueDate: c.today })],
  ['date', `(?:la semana que viene|la proxima semana|la semana proxima)`, (m, c) => ({ dueDate: nextWeekday(c.today, 1) })],
  ['date', `(?:el|este) (?:fin de semana|finde)`, (m, c) => ({ dueDate: isoDay(c.today) === 6 ? c.today : nextWeekday(c.today, 6) })],
  ['date', `dentro de (${NUM_RE}) ${UNIT_RE}|en (${NUM_RE}) (?:dias|semanas|meses)`, (m, c) => {
    const n = num(m[1] || m[2]);
    const unit = UNIT[m[0].split(' ').pop()];
    if (unit === 'd') return { dueDate: addDays(c.today, n) };
    if (unit === 'w') return { dueDate: addDays(c.today, 7 * n) };
    const t = parseYmd(c.today);
    return { dueDate: ymd(new Date(t.getFullYear() + (unit === 'y' ? n : 0), t.getMonth() + (unit === 'm' ? n : 0), t.getDate())) };
  }],
  ['date', `(?:el |este |el proximo |el )?(${WD_RE})(?: que viene| proximo)?`, (m, c) => ({ dueDate: nextWeekday(c.today, weekdayIndex(m[1])) })],
  ['date', `(?:el )?(?:dia )?(\\d{1,2}) de (${MONTH_RE})(?: de (\\d{4}))?`, (m, c) => ({ dueDate: dateOf(c.today, Number(m[1]), monthIndex(m[2]), m[3] && Number(m[3])) })],
  ['date', `(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?`, (m, c) => ({ dueDate: dateOf(c.today, Number(m[1]), Number(m[2]), m[3] && Number(m[3])) })],
  ['date', `el (?:dia )?(\\d{1,2})`, (m, c) => (Number(m[1]) >= 1 && Number(m[1]) <= 31 ? { dueDate: nextDayOfMonth(c.today, Number(m[1])) } : null)],
];

// Palabras de enlace que sobran al quitar lo entendido («… el», «y …», «para …»).
const CONNECTORS = new Set(['el', 'la', 'los', 'las', 'y', 'e', 'de', 'a', 'para', 'que', 'en', 'le', 'toca']);

/**
 * @param {string} text
 * @param {{today?: string, members?: {id:string, name:string}[], ignore?: Set<string>}} opts
 *   ignore: tipos descartados por la persona ('date', 'repeat', 'from', 'who').
 * @returns {{title:string, dueDate:string|null, repeat:string|null, repeatFrom:string|null,
 *   assignee:string|null, assigneeName:string|null, found:string[]}}
 */
export function parseTask(text, { today = todayKey(), members = [], ignore = new Set() } = {}) {
  const src = String(text || '');
  const low = fold(src);
  const taken = [];
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
  const out = { dueDate: null, repeat: null, repeatFrom: null, assignee: null, assigneeName: null };
  let interval = null, days = null;
  const seen = new Set();

  for (const [kind, pattern, fn] of RULES) {
    if (ignore.has(kind)) continue;
    const re = new RegExp(`(?<![a-z0-9])(?:${pattern})(?![a-z0-9])`, 'g');
    for (const m of low.matchAll(re)) {
      const a = m.index, b = m.index + m[0].length;
      if (!free(a, b)) continue;
      const v = fn(m, { today });
      if (!v) continue;
      if (kind === 'date') { if (seen.has('date')) continue; out.dueDate = v.dueDate; }
      if (kind === 'from') { if (seen.has('from')) continue; out.repeatFrom = v.repeatFrom; }
      if (kind === 'repeat') {
        // «cada 2 semanas» + «los sábados» se combinan; el resto, solo la primera.
        if (v.days && !days) days = v.days;
        else if (v.n && !interval) interval = v;
        else if (v.repeat && !out.repeat) { out.repeat = v.repeat; if (v.dueDate && !seen.has('date')) { out.dueDate = v.dueDate; seen.add('date'); } }
        else continue;
      }
      seen.add(kind);
      taken.push([a, b]);
      if (kind !== 'repeat') break;
    }
  }
  if (!out.repeat && (days || interval)) {
    if (days) out.repeat = normalizeRepeat(`${interval && interval.unit === 'w' ? interval.n : 1}w:${days.join(',')}`);
    else out.repeat = normalizeRepeat(`${interval.n}${interval.unit}`);
  }
  if (!out.repeat) { out.repeatFrom = null; seen.delete('from'); }

  // «para Ana» / «le toca a Ana»: solo nombres de miembros del grupo.
  if (!ignore.has('who')) {
    for (const mem of members) {
      const name = fold(mem.name.trim()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!name) continue;
      const m = new RegExp(`(?<![a-z0-9])(?:para|le toca a) ${name}(?![a-z0-9])`).exec(low);
      if (m && free(m.index, m.index + m[0].length)) {
        out.assignee = mem.id; out.assigneeName = mem.name; seen.add('who');
        taken.push([m.index, m.index + m[0].length]);
        break;
      }
    }
  }

  // Título: el texto sin lo entendido ni las palabras de enlace que quedan sueltas.
  let title = '';
  let i = 0;
  for (const [a, b] of [...taken].sort((x, y) => x[0] - y[0])) { title += src.slice(i, a) + ' '; i = b; }
  title += src.slice(i);
  let words = title.replace(/\s*,\s*/g, ' ').split(/\s+/).filter(Boolean);
  if (taken.length) {
    while (words.length > 1 && CONNECTORS.has(fold(words[words.length - 1]))) words.pop();
    while (words.length > 1 && CONNECTORS.has(fold(words[0]))) words.shift();
  }
  title = words.join(' ');
  title = title.charAt(0).toUpperCase() + title.slice(1);

  return { title, ...out, found: [...seen] };
}
