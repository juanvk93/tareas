// Pruebas unitarias (sin dependencias): npm test
// Cubren la lógica pura (fechas, repeticiones, catálogo) y la coherencia del
// proyecto (versiones, iconos, archivos del Service Worker).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nextDue, currentDue, parseRepeat, normalizeRepeat, repeatLabel, isRepeating, addDays, alignDue, isoDay, REPEAT_PRESETS,
  countsFromDone, todoDue, nextDueOnComplete, todoRepeatLabel, resumeDue, isPaused,
  postponePatch } from '../js/dates.js';
import { DEFAULT_CATALOG, DEFAULT_ROUTINES, searchItems, guessIcon, normalizeTitle } from '../js/catalog.js';
import { APP_VERSION, CHANGELOG, compareVersions } from '../js/changelog.js';
import { icon, TASK_ICONS } from '../js/icons.js';
import { maskUrl, maskSecret } from '../js/diag.js';
import { KEEP_DONE_DAYS, KEEP_DELETED_DAYS } from '../js/db.js';
import { REQUIRED_SCRIPT_VERSION } from '../js/sync.js';
import { createGasSim } from './gas-sim.mjs';
import { parseTask } from '../js/parse.js';
import { recipientsOf, subscribeLink, randomTopic, isValidTopic, splitAssignee } from '../js/notify.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');
/** Todos los .js de la app (js/ y subcarpetas), con ruta relativa a la raíz. */
const appModules = async () => (await readdir(join(ROOT, 'js'), { recursive: true }))
  .filter((f) => f.endsWith('.js')).map((f) => join('js', f));

/* ------------------------------- Fechas -------------------------------- */
describe('dates.js', () => {
  test('addDays cruza meses y años', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });

  test('parseRepeat / normalizeRepeat', () => {
    assert.deepEqual(parseRepeat('2w'), { n: 2, unit: 'w' });
    assert.deepEqual(parseRepeat('weekly'), { n: 1, unit: 'w' });
    assert.equal(parseRepeat('none'), null);
    assert.equal(parseRepeat('0d'), null);
    assert.equal(parseRepeat(''), null);
    assert.equal(parseRepeat(undefined), null);
    assert.equal(normalizeRepeat('monthly'), '1m');
    assert.equal(normalizeRepeat('basura'), 'none');
    assert.equal(isRepeating('3d'), true);
    assert.equal(isRepeating('none'), false);
  });

  test('repeatLabel', () => {
    assert.equal(repeatLabel('none'), 'No se repite');
    assert.equal(repeatLabel('1d'), 'Cada día');
    assert.equal(repeatLabel('1w'), 'Cada semana');
    assert.equal(repeatLabel('2w'), 'Cada 2 semanas');
    assert.equal(repeatLabel('3d'), 'Cada 3 días');
    assert.equal(repeatLabel('6m'), 'Cada 6 meses');
    assert.equal(repeatLabel('1y'), 'Cada año');
    for (const p of REPEAT_PRESETS) assert.ok(repeatLabel(p), p);
  });

  test('nextDue: siguiente fecha posterior a hoy', () => {
    const T = '2026-10-30';
    assert.equal(nextDue(T, '1d', T), '2026-10-31');
    assert.equal(nextDue(T, '2w', T), '2026-11-13');
    assert.equal(nextDue(T, '3w', T), '2026-11-20');
    assert.equal(nextDue(T, 'weekly', T), '2026-11-06');
    assert.equal(nextDue(T, 'none', T), null);
  });

  test('nextDue salta las repeticiones perdidas', () => {
    assert.equal(nextDue('2026-10-01', '2w', '2026-10-30'), '2026-11-12');
    assert.equal(nextDue('2026-10-20', '1d', '2026-10-30'), '2026-10-31');
  });

  test('meses: fin de mes y años bisiestos', () => {
    assert.equal(nextDue('2026-01-31', '1m', '2026-01-31'), '2026-02-28');
    assert.equal(nextDue('2028-01-31', '1m', '2028-01-31'), '2028-02-29');
    assert.equal(nextDue('2026-01-31', '6m', '2026-01-31'), '2026-07-31');
    assert.equal(nextDue('2026-02-28', '1y', '2026-02-28'), '2027-02-28');
  });

  test('currentDue: ocurrencia vigente', () => {
    // Diaria atrasada: siempre es de hoy.
    assert.equal(currentDue('2026-10-25', '1d', '2026-10-30'), '2026-10-30');
    // Semanal del jueves pasado, hoy jueves: toca hoy.
    assert.equal(currentDue('2026-10-22', '1w', '2026-10-29'), '2026-10-29');
    // Semanal de ayer: sigue atrasada (aún no toca la siguiente).
    assert.equal(currentDue('2026-10-28', '1w', '2026-10-29'), '2026-10-28');
    // Cada 3 semanas: agrupa en la más reciente que no pasa de hoy.
    assert.equal(currentDue('2026-10-01', '3w', '2026-10-30'), '2026-10-22');
    assert.equal(currentDue('2026-10-01', '3w', '2026-10-21'), '2026-10-01');
    // Sin repetición o con fecha futura: su propia fecha.
    assert.equal(currentDue('2026-10-01', 'none', '2026-10-30'), '2026-10-01');
    assert.equal(currentDue('2026-11-05', '1d', '2026-10-30'), '2026-11-05');
  });
});

/* ------------------------- Días de la semana --------------------------- */
describe('repetir en días de la semana', () => {
  // 2026-11-02 es lunes.
  const series = (start, r, n) => {
    const out = [start];
    for (let i = 0; i < n; i++) out.push(nextDue(out[out.length - 1], r, out[out.length - 1]));
    return out;
  };

  test('isoDay: 1 = lunes … 7 = domingo', () => {
    assert.equal(isoDay('2026-11-02'), 1);
    assert.equal(isoDay('2026-11-05'), 4);
    assert.equal(isoDay('2026-11-08'), 7);
  });

  test('parseRepeat / normalizeRepeat con días', () => {
    assert.deepEqual(parseRepeat('1w:4,1,1'), { n: 1, unit: 'w', days: [1, 4] });
    assert.equal(normalizeRepeat('1w:4,1'), '1w:1,4');
    assert.equal(normalizeRepeat('1w:1,2,3,4,5,6,7'), '1d', 'todos los días cada semana = cada día');
    assert.equal(normalizeRepeat('2w:1,2,3,4,5,6,7'), '2w:1,2,3,4,5,6,7');
    assert.equal(parseRepeat('1d:1'), null, 'los días solo valen con semanas');
    assert.equal(parseRepeat('1w:8'), null);
    assert.equal(parseRepeat('1w:'), null);
  });

  test('etiquetas', () => {
    assert.equal(repeatLabel('1w:1,4'), 'Lunes y jueves');
    assert.equal(repeatLabel('1w:1,3,5'), 'Lun, mié y vie');
    assert.equal(repeatLabel('1w:1,2,3,4,5'), 'Entre semana');
    assert.equal(repeatLabel('1w:6,7'), 'Fines de semana');
    assert.equal(repeatLabel('1w:6'), 'Cada sábado');
    assert.equal(repeatLabel('2w:6'), 'Cada 2 semanas: sáb');
    assert.equal(repeatLabel('3w:2,4'), 'Cada 3 semanas: mar y jue');
  });

  test('lunes y jueves', () => {
    assert.deepEqual(series('2026-11-02', '1w:1,4', 4), ['2026-11-02', '2026-11-05', '2026-11-09', '2026-11-12', '2026-11-16']);
  });

  test('sábados alternos y «cada 2 semanas, lunes y jueves»', () => {
    assert.deepEqual(series('2026-10-31', '2w:6', 3), ['2026-10-31', '2026-11-14', '2026-11-28', '2026-12-12']);
    assert.deepEqual(series('2026-11-02', '2w:1,4', 4), ['2026-11-02', '2026-11-05', '2026-11-16', '2026-11-19', '2026-11-30']);
  });

  test('cruza fin de mes y de año', () => {
    assert.deepEqual(series('2026-12-28', '1w:1,5', 3), ['2026-12-28', '2027-01-01', '2027-01-04', '2027-01-08']);
  });

  test('alignDue: la primera vez es el siguiente día marcado', () => {
    assert.equal(alignDue('2026-10-30', '1w:1,4'), '2026-11-02'); // viernes → lunes
    assert.equal(alignDue('2026-11-03', '1w:1,4'), '2026-11-05'); // martes → jueves
    assert.equal(alignDue('2026-11-05', '1w:1,4'), '2026-11-05'); // ya es jueves
    assert.equal(alignDue('2026-11-08', '1w:6'), '2026-11-14');   // domingo → sábado
    assert.equal(alignDue('2026-11-03', '2w'), '2026-11-03');     // sin días: no cambia
  });

  test('nextDue y currentDue con días: saltan y agrupan los perdidos', () => {
    assert.equal(nextDue('2026-11-02', '1w:1,4', '2026-11-10'), '2026-11-12');
    assert.equal(currentDue('2026-11-02', '1w:1,4', '2026-11-10'), '2026-11-09'); // el lunes 9 toca
    assert.equal(currentDue('2026-11-02', '1w:1,4', '2026-11-04'), '2026-11-02'); // aún no es jueves
  });
});

/* ------------------- Contar desde el día en que se hace ---------------- */
describe('repetir desde el día en que se hace', () => {
  const filtros = { dueDate: '2026-10-18', repeat: '10d', repeatFrom: 'done' };
  const calendario = { dueDate: '2026-10-18', repeat: '10d' };

  test('solo con intervalos', () => {
    assert.equal(countsFromDone(filtros), true);
    assert.equal(countsFromDone(calendario), false);
    assert.equal(countsFromDone({ ...filtros, repeat: '1w:1,4' }), false, 'con días de la semana manda el calendario');
    assert.equal(countsFromDone({ ...filtros, repeat: 'none' }), false);
  });

  test('la siguiente cuenta desde el día en que se resuelve', () => {
    assert.equal(nextDueOnComplete(filtros, '2026-10-30'), '2026-11-09');
    // Con calendario: siguiente fecha de la serie posterior a hoy (18 → 28 → 7 nov).
    assert.equal(nextDueOnComplete(calendario, '2026-10-30'), '2026-11-07');
    assert.equal(nextDueOnComplete({ dueDate: '2026-10-18', repeat: 'none' }, '2026-10-30'), null);
  });

  test('si va atrasada no se agrupa: sigue con su fecha', () => {
    assert.equal(todoDue(filtros, '2026-10-30'), '2026-10-18');
    assert.equal(todoDue(calendario, '2026-10-30'), '2026-10-28');
  });

  test('etiqueta', () => {
    assert.equal(todoRepeatLabel(filtros), 'Cada 10 días desde la última vez');
    assert.equal(todoRepeatLabel(calendario), 'Cada 10 días');
  });
});

/* ------------------------------ Posponer ------------------------------- */
describe('posponer', () => {
  // Cada lunes (2026-11-02 es lunes), pospuesta al martes.
  const lunes = { dueDate: '2026-11-02', repeat: '1w' };
  const pospuesta = { ...lunes, ...postponePatch(lunes, '2026-11-03', '2026-11-02') };

  test('guarda la fecha de la serie solo en repetidas con calendario', () => {
    assert.deepEqual(postponePatch(lunes, '2026-11-03', '2026-11-02'), { dueDate: '2026-11-03', seriesDue: '2026-11-02' });
    assert.deepEqual(postponePatch({ dueDate: '2026-11-02', repeat: 'none' }, '2026-11-03'), { dueDate: '2026-11-03' });
    assert.deepEqual(postponePatch({ dueDate: '2026-11-02', repeat: '10d', repeatFrom: 'done' }, '2026-11-03'), { dueDate: '2026-11-03' });
  });

  test('si iba atrasada, la serie parte de la repetición vigente', () => {
    // Diaria del 25, pospuesta el 30 → la serie va por el 30.
    assert.equal(postponePatch({ dueDate: '2026-10-25', repeat: '1d' }, '2026-10-31', '2026-10-30').seriesDue, '2026-10-30');
  });

  test('fecha vigente de una pospuesta', () => {
    assert.equal(todoDue(pospuesta, '2026-11-02'), '2026-11-03'); // aún no ha llegado
    assert.equal(todoDue(pospuesta, '2026-11-04'), '2026-11-03'); // pasó sin hacerla: atrasada
    assert.equal(todoDue(pospuesta, '2026-11-09'), '2026-11-09'); // la serie ya va por el lunes siguiente
  });

  test('la siguiente sigue el calendario de la serie', () => {
    assert.equal(nextDueOnComplete(pospuesta, '2026-11-03'), '2026-11-09'); // lunes, no martes 10
    assert.equal(nextDueOnComplete(pospuesta, '2026-11-02'), '2026-11-09'); // hecha antes de la fecha pospuesta
    assert.equal(nextDueOnComplete(pospuesta, '2026-11-10'), '2026-11-16'); // hecha tarde
  });
});

/* ------------------------------- Pausa --------------------------------- */
describe('pausa', () => {
  test('resumeDue: primera repetición desde la fecha de vuelta', () => {
    // Lunes y jueves; vuelta el sábado 14 → lunes 16.
    assert.equal(resumeDue({ dueDate: '2026-11-02', repeat: '1w:1,4' }, '2026-11-14'), '2026-11-16');
    // Si la vuelta es justo un día de la serie, ese mismo día.
    assert.equal(resumeDue({ dueDate: '2026-11-02', repeat: '1w:1,4' }, '2026-11-12'), '2026-11-12');
    // Cada 2 semanas desde el 31 oct: 14 nov, 28 nov… vuelta el 20 → 28.
    assert.equal(resumeDue({ dueDate: '2026-10-31', repeat: '2w' }, '2026-11-20'), '2026-11-28');
    // Desde que se hace: vuelve el mismo día de la vuelta.
    assert.equal(resumeDue({ dueDate: '2026-10-31', repeat: '10d', repeatFrom: 'done' }, '2026-11-20'), '2026-11-20');
    // Si ya era posterior, no cambia.
    assert.equal(resumeDue({ dueDate: '2026-12-01', repeat: '1d' }, '2026-11-20'), '2026-12-01');
  });

  test('isPaused', () => {
    assert.equal(isPaused({ paused: true }, '2026-10-30'), true);
    assert.equal(isPaused({ pausedUntil: '2026-11-05' }, '2026-10-30'), true);
    assert.equal(isPaused({ pausedUntil: '2026-11-05' }, '2026-11-05'), false, 'el día de la vuelta ya no está en pausa');
    assert.equal(isPaused({}, '2026-10-30'), false);
  });
});

/* --------------------- Escribir con naturalidad ------------------------- */
describe('parse.js', () => {
  const today = '2026-10-30'; // viernes
  const members = [{ id: 'a', name: 'Ana' }, { id: 'j', name: 'Juan' }];
  const P = (text, opts = {}) => {
    const r = parseTask(text, { today, members, ...opts });
    return { title: r.title, dueDate: r.dueDate, repeat: r.repeat, repeatFrom: r.repeatFrom, who: r.assigneeName };
  };
  const only = (o) => ({ dueDate: null, repeat: null, repeatFrom: null, who: null, ...o });

  test('fechas', () => {
    assert.deepEqual(P('Fregar los platos mañana'), only({ title: 'Fregar los platos', dueDate: '2026-10-31' }));
    assert.deepEqual(P('Pasar la aspiradora pasado mañana'), only({ title: 'Pasar la aspiradora', dueDate: '2026-11-01' }));
    assert.deepEqual(P('Cocinar hoy'), only({ title: 'Cocinar', dueDate: today }));
    assert.equal(P('Limpiar el horno el domingo').dueDate, '2026-11-01');
    assert.equal(P('Ir al banco el viernes').dueDate, '2026-11-06', '«el viernes» siendo viernes = el siguiente');
    assert.equal(P('Llamar al médico el 15 de noviembre').dueDate, '2026-11-15');
    assert.equal(P('Renovar el DNI el 2 de enero').dueDate, '2027-01-02', 'si ya pasó este año, el que viene');
    assert.equal(P('Revisar caldera 3/11').dueDate, '2026-11-03');
    assert.equal(P('Ir al banco el 5').dueDate, '2026-11-05');
    assert.equal(P('Ir al banco el 31').dueDate, '2026-10-31');
    assert.equal(P('Planchar la semana que viene').dueDate, '2026-11-02');
    assert.equal(P('Recoger paquete dentro de 3 días').dueDate, '2026-11-02');
    assert.equal(P('Cortar el césped en 2 semanas').dueDate, '2026-11-13');
    assert.equal(P('Hacer la compra el fin de semana').dueDate, '2026-10-31');
  });

  test('repeticiones', () => {
    assert.deepEqual(P('Sacar el vidrio el viernes cada 2 semanas'), only({ title: 'Sacar el vidrio', dueDate: '2026-11-06', repeat: '2w' }));
    assert.deepEqual(P('Regar las plantas los lunes y jueves'), only({ title: 'Regar las plantas', repeat: '1w:1,4' }));
    assert.equal(P('Ir al gimnasio lunes, miércoles y viernes').repeat, '1w:1,3,5');
    assert.equal(P('Sacar la basura entre semana').repeat, '1w:1,2,3,4,5');
    assert.equal(P('Limpiar a fondo los fines de semana').repeat, '1w:6,7');
    assert.equal(P('Tomar la medicación todos los días').repeat, '1d');
    assert.equal(P('Fregar el suelo cada quince días').repeat, '15d');
    assert.equal(P('Limpiar cristales cada mes').repeat, '1m');
    assert.equal(P('Pagar el seguro cada año').repeat, '1y');
    assert.equal(P('Cambiar las sábanas cada dos semanas los sábados').repeat, '2w:6');
    assert.deepEqual(P('Pagar el alquiler el 1 de cada mes'), only({ title: 'Pagar el alquiler', dueDate: '2026-11-01', repeat: '1m' }));
    assert.deepEqual(P('Limpiar filtros cada 10 días desde que se haga'), only({ title: 'Limpiar filtros', repeat: '10d', repeatFrom: 'done' }));
  });

  test('a quién le toca (solo miembros del grupo)', () => {
    assert.deepEqual(P('Comprar pan para Ana'), only({ title: 'Comprar pan', who: 'Ana' }));
    assert.deepEqual(P('Poner la lavadora hoy y le toca a Juan'), only({ title: 'Poner la lavadora', dueDate: today, who: 'Juan' }));
    assert.equal(P('Comprar regalo para mamá').title, 'Comprar regalo para mamá');
  });

  test('sin nada que entender, el texto no cambia', () => {
    assert.deepEqual(P('Hacer la cama'), only({ title: 'Hacer la cama' }));
    assert.equal(P('Limpiar el baño').title, 'Limpiar el baño');
  });

  test('lo descartado se queda en el título', () => {
    assert.deepEqual(P('Fregar los platos mañana', { ignore: new Set(['date']) }), only({ title: 'Fregar los platos mañana' }));
    const r = P('Sacar el vidrio el viernes cada 2 semanas', { ignore: new Set(['repeat']) });
    assert.equal(r.title, 'Sacar el vidrio cada 2 semanas');
    assert.equal(r.dueDate, '2026-11-06');
  });
});

/* --------------------------- Avisos (ntfy) ----------------------------- */
describe('notify.js', () => {
  const group = { ntfyServer: 'https://ntfy.sh' };
  const members = [
    { id: 'j', name: 'Juan', notify: true, ntfyTopic: 'casa-juan-abc123' },
    { id: 'a', name: 'Ana', notify: true, ntfyTopic: 'casa-ana-xyz789', ntfyServer: 'https://ntfy.example.org' },
    { id: 'p', name: 'Pepe', notify: false, ntfyTopic: 'casa-pepe-111' },
    { id: 'l', name: 'Luis', notify: true, ntfyTopic: '' }
  ];

  test('los avisos van a los demás que los reciben (nunca a quien hace el cambio)', () => {
    assert.deepEqual(recipientsOf(group, members, 'j').map((r) => [r.name, r.topic, r.server]),
      [['Ana', 'casa-ana-xyz789', 'https://ntfy.example.org']]);
    assert.deepEqual(recipientsOf(group, members, 'a').map((r) => [r.name, r.server]), [['Juan', 'https://ntfy.sh']]);
    assert.deepEqual(recipientsOf(group, [members[0]], 'j'), [], 'grupo de una persona: nadie a quien avisar');
  });

  test('a quien se le asigna recibe «te ha asignado»; el resto, el aviso normal', () => {
    const to = [{ id: 'a', name: 'Ana' }, { id: 'p', name: 'Pepe' }];
    assert.deepEqual(splitAssignee(to, 'a'), { assignee: to[0], rest: [to[1]] });
    assert.deepEqual(splitAssignee(to, null), { assignee: null, rest: to });
    assert.deepEqual(splitAssignee(to, 'j'), { assignee: null, rest: to }, 'asignada a quien la crea: aviso normal a los demás');
  });

  test('enlace para suscribirse en la app ntfy', () => {
    assert.equal(subscribeLink('https://ntfy.sh', 'casa-juan-abc123', 'Tareas Hogar'), 'ntfy://ntfy.sh/casa-juan-abc123?display=Tareas+Hogar');
    assert.equal(subscribeLink('http://192.168.1.5:8080/', 't1'), 'ntfy://192.168.1.5:8080/t1?secure=false');
  });

  test('temas aleatorios válidos y distintos', () => {
    const a = randomTopic('Tareas Hogar Juan'), b = randomTopic('Tareas Hogar Juan');
    assert.ok(isValidTopic(a) && a.startsWith('tareas-hogar-juan-'), a);
    assert.notEqual(a, b);
    assert.ok(isValidTopic(randomTopic('Ñandú & Café')));
  });
});

/* ---------------------------- Diagnóstico ------------------------------ */
describe('diag.js', () => {
  test('maskUrl quita la querystring (lleva la clave) y recorta el id del script', () => {
    const url = 'https://script.google.com/macros/s/AKfycbxCw-A2scsRhakTw4cSHmwEuRbKxcoLlafeGeMMfhqimcsEoIY-XLqDbWrxJCEmBbFE/exec?action=pull&token=secreto';
    const m = maskUrl(url);
    assert.equal(m, 'https://script.google.com/macros/s/AKfycb…BbFE/exec');
    assert.ok(!m.includes('secreto'));
    assert.equal(maskUrl(''), '');
    assert.equal(maskUrl('no es url'), '(URL no válida)');
  });

  test('maskSecret', () => {
    assert.equal(maskSecret('tareas-hogar-k3j9x2m1qa'), 'tare…qa');
    assert.equal(maskSecret('abc'), '•••');
    assert.equal(maskSecret(''), '');
  });
});

/* ------------------------------ Catálogo ------------------------------- */
describe('catalog.js', () => {
  const items = DEFAULT_CATALOG.flatMap((c) => c.items);

  test('búsqueda sin tildes ni mayúsculas', () => {
    assert.equal(normalizeTitle('  Limpiar el BAÑO '), 'limpiar el bano');
    assert.ok(searchItems(items, 'BAÑO').some((i) => i.name === 'Limpiar el baño'));
    assert.ok(searchItems(items, 'bano').some((i) => i.name === 'Limpiar el baño'));
    assert.deepEqual(searchItems(items, ''), []);
  });

  test('guessIcon', () => {
    assert.equal(guessIcon('Fregar los platos'), 'dishes');
    assert.equal(guessIcon('Limpiar el baño de arriba'), 'toilet');
    assert.equal(guessIcon('Algo totalmente nuevo'), 'sparkles');
  });

  test('las rutinas iniciales usan tareas del catálogo', () => {
    const names = new Set(items.map((i) => i.name));
    for (const r of DEFAULT_ROUTINES) {
      assert.ok(r.items.length, `«${r.name}» sin tareas`);
      for (const t of r.items) assert.ok(names.has(t), `«${r.name}»: «${t}» no está en el catálogo`);
      assert.ok(TASK_ICONS.includes(r.icon));
    }
  });

  test('sin tareas repetidas y con iconos elegibles', () => {
    const names = items.map((i) => normalizeTitle(i.name));
    assert.equal(new Set(names).size, names.length, 'hay tareas repetidas en el catálogo');
    for (const i of items) assert.ok(TASK_ICONS.includes(i.icon), `«${i.name}» usa «${i.icon}», que no está en TASK_ICONS`);
  });
});

/* ------------------------- Versión y changelog ------------------------- */
describe('versión', () => {
  test('APP_VERSION = primera entrada del changelog', () => {
    assert.equal(CHANGELOG[0].version, APP_VERSION);
  });

  test('CACHE_VERSION del Service Worker = APP_VERSION', async () => {
    const sw = await read('sw.js');
    assert.match(sw, new RegExp(`CACHE_VERSION = 'v${APP_VERSION.replace(/\./g, '\\.')}'`),
      'sube CACHE_VERSION en sw.js: si no, los móviles siguen con la versión vieja');
  });

  test('entradas ordenadas, con fecha y tipos válidos', () => {
    for (let i = 0; i < CHANGELOG.length; i++) {
      const e = CHANGELOG[i];
      assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, e.version);
      assert.ok(e.changes.length, `${e.version} sin cambios`);
      for (const c of e.changes) {
        assert.ok(['add', 'chg', 'fix'].includes(c.type), `${e.version}: tipo «${c.type}»`);
        assert.ok(c.text && c.text.trim(), `${e.version}: texto vacío`);
      }
      if (i) {
        assert.ok(compareVersions(CHANGELOG[i - 1].version, e.version) > 0, `${CHANGELOG[i - 1].version} debe ser mayor que ${e.version}`);
        assert.ok(CHANGELOG[i - 1].date >= e.date, `fechas desordenadas en ${e.version}`);
      }
    }
  });

  test('CHANGELOG.md está regenerado', async () => {
    const md = await read('CHANGELOG.md');
    assert.ok(md.includes(`Versión actual: **${APP_VERSION}**`), 'ejecuta npm run changelog');
  });
});

/* -------------------------------- Iconos -------------------------------- */
describe('iconos', () => {
  const fallback = icon('__no_existe__');

  test('todos los iconos usados existen', async () => {
    const used = new Set(TASK_ICONS);
    const files = [...await appModules(), 'index.html'];
    for (const f of files) {
      const src = await read(f);
      for (const m of src.matchAll(/icon\('([a-z-]+)'/g)) used.add(m[1]);
      for (const m of src.matchAll(/data-icon="([a-z-]+)"/g)) used.add(m[1]);
      for (const m of src.matchAll(/\bicon: '([a-z-]+)'/g)) used.add(m[1]);
    }
    const missing = [...used].filter((n) => n !== 'help' && icon(n) === fallback);
    assert.deepEqual(missing, [], `iconos sin dibujo en icons.js: ${missing.join(', ')}`);
  });
});

/* ---------------------- Archivos del Service Worker --------------------- */
describe('Service Worker', () => {
  // Recorre los imports estáticos y dinámicos desde js/app.js. Los fetch('ruta')
  // con ruta relativa (p. ej. apps-script/Code.gs) se resuelven desde index.html.
  async function moduleGraph(entry) {
    const seen = new Set();
    const visit = async (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      if (!file.endsWith('.js')) return;
      const src = await read(file);
      const re = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
      for (const m of src.matchAll(re)) await visit(normalize(join(dirname(file), m[1])));
      for (const m of src.matchAll(/fetch\('([\w./-]+\.\w+)'\)/g)) await visit(normalize(m[1]));
    };
    await visit(entry);
    return seen;
  }
  const shellOf = (sw) => [...sw.match(/const APP_SHELL = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  test('ningún módulo de js/ se queda sin usar', async () => {
    const graph = await moduleGraph('js/app.js');
    const unused = (await appModules()).filter((f) => !graph.has(normalize(f)));
    assert.deepEqual(unused, [], `módulos que no importa nadie: ${unused.join(', ')}`);
  });

  test('todo módulo que carga la app está en APP_SHELL (si no, falla sin conexión)', async () => {
    const shell = new Set(shellOf(await read('sw.js')).map((p) => normalize(p)));
    const graph = await moduleGraph('js/app.js');
    const missing = [...graph].filter((f) => !shell.has(f));
    assert.deepEqual(missing, [], `añade a APP_SHELL: ${missing.join(', ')}`);
  });

  test('lo que enlaza index.html está en APP_SHELL', async () => {
    const shell = new Set(shellOf(await read('sw.js')).map((p) => normalize(p)));
    const html = await read('index.html');
    const refs = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map((m) => normalize(m[1]));
    const missing = refs.filter((r) => !shell.has(r));
    assert.deepEqual(missing, [], `añade a APP_SHELL: ${missing.join(', ')}`);
  });

  test('todos los archivos de APP_SHELL existen', async () => {
    for (const p of shellOf(await read('sw.js'))) {
      if (p === './') continue;
      await assert.doesNotReject(access(join(ROOT, p)), `no existe ${p}`);
    }
  });
});

/* -------------------- Script de Google (Code.gs simulado) -------------------- */
describe('Code.gs', () => {
  const DAY = 24 * 3600 * 1000;
  const row = (store, id, updatedAt, data = {}, deleted = false) => ({ store, id, updatedAt, deleted, data });
  const sync = (sim, since, records = []) => sim.request('POST', {}, { action: 'sync', since, records });

  test('mismos plazos y versión que la app', () => {
    const { ctx } = createGasSim();
    assert.equal(ctx.KEEP_DONE_DAYS, KEEP_DONE_DAYS);
    assert.equal(ctx.KEEP_DELETED_DAYS, KEEP_DELETED_DAYS);
    assert.equal(ctx.SCRIPT_VERSION, REQUIRED_SCRIPT_VERSION);
  });

  test('las fechas del script coinciden con dates.js', () => {
    const { ctx } = createGasSim();
    const repeats = ['none', '1d', '3d', '1w', '2w', '3w', '1m', '2m', '6m', '1y', '1w:1,4', '2w:6', '1w:1,2,3,4,5', '1w:6,7', '3w:2,4', '10d'];
    const todays = ['2026-10-30', '2026-12-31', '2027-01-01', '2028-02-28', '2028-02-29', '2026-03-31', '2026-11-02'];
    let n = 0;
    for (const today of todays) for (const repeat of repeats) for (const off of [-400, -40, -13, -8, -7, -6, -1, 0, 1, 9]) {
      const dueDate = addDays(today, off);
      const variants = [
        { dueDate, repeat },
        { dueDate, repeat, repeatFrom: 'done' },
        { dueDate: addDays(dueDate, 2), repeat, seriesDue: dueDate },
        { dueDate: addDays(today, 1), repeat, seriesDue: dueDate }
      ];
      for (const t of variants) {
        assert.equal(ctx.todoDue_(t, today), todoDue(t, today), `${JSON.stringify(t)} hoy ${today}`);
        n++;
      }
    }
    assert.ok(n > 4000);
  });

  test('sync: incremental, sin devolver lo enviado y con números de cambio', () => {
    const sim = createGasSim();
    const a1 = sync(sim, 0, [row('todos', 't1', 10, { title: 'A' }), row('todos', 't2', 10, { title: 'B' })]);
    assert.equal(a1.ok, true);
    assert.equal(a1.version, 2);
    assert.equal(a1.full, true, 'la primera vez es la lista completa');
    assert.deepEqual(a1.records, [], 'no devuelve lo que acaba de enviar');
    assert.equal(a1.rev, 2);
    assert.equal(sync(createGasSim(), 0, []).rev, 1, 'aunque no haya cambios, rev nunca es 0');
    // Otro móvil, primera vez: recibe todo.
    const b1 = sync(sim, 0, []);
    assert.deepEqual(b1.records.map((r) => r.id).sort(), ['t1', 't2']);
    // B cambia t1; A recibe solo eso.
    const b2 = sync(sim, b1.rev, [row('todos', 't1', 20, { title: 'A2' })]);
    assert.deepEqual(b2.records, []);
    const a2 = sync(sim, a1.rev, []);
    assert.equal(a2.full, false);
    assert.deepEqual(a2.records.map((r) => [r.id, r.data.title]), [['t1', 'A2']]);
    // Reenviar lo mismo (igual updatedAt) o algo más viejo no cuenta como cambio.
    const a3 = sync(sim, a2.rev, [row('todos', 't1', 20, { title: 'A2' }), row('todos', 't2', 5, { title: 'viejo' })]);
    assert.equal(a3.rev, a2.rev);
    assert.equal(sim.sheetRows().find((r) => r[1] === 't2')[4], JSON.stringify({ title: 'B' }));
    // Sin cambios: nada que bajar.
    assert.deepEqual(sync(sim, a3.rev, []).records, []);
  });

  test('compatibilidad: apps antiguas (pull/push) y hojas de la versión 1', () => {
    const sim = createGasSim();
    // Hoja creada por el script v1: 5 columnas, sin «rev».
    const sh = sim.ctx.SpreadsheetApp.getActiveSpreadsheet().insertSheet('tareas_data');
    sh.appendRow(['store', 'id', 'updatedAt', 'deleted', 'json']);
    sh.appendRow(['todos', 'viejo', 5, 0, JSON.stringify({ title: 'De antes' })]);
    const first = sync(sim, 0, []);
    assert.deepEqual(first.records.map((r) => r.id), ['viejo']);
    assert.equal(sim.sheetRows()[0][5], 'rev', 'se añade la columna rev');
    // Una app antigua sube con push: la nueva lo recibe por sync.
    const pushed = sim.request('POST', {}, { action: 'push', records: [row('todos', 'p1', 30, { title: 'Desde la app vieja' })] });
    assert.equal(pushed.ok, true);
    assert.ok(pushed.records.some((r) => r.id === 'p1'));
    assert.deepEqual(sync(sim, first.rev, []).records.map((r) => r.id), ['p1']);
    // Y la antigua sigue leyendo todo con pull.
    assert.equal(sim.request('GET', { action: 'pull' }).records.length, 2);
    // El script v1 no conoce sync: la app lo detecta por este error y usa pull/push.
    const v1 = createGasSim({ source: 'tools/fixtures/Code.v1.gs' });
    assert.equal(v1.request('POST', {}, { action: 'sync', since: 0, records: [] }).error, 'accion desconocida');
  });

  test('clave secreta', () => {
    const sim = createGasSim();
    sim.ctx.SECRET = 'clave';
    assert.equal(sync(sim, 0, []).error, 'unauthorized');
    assert.equal(sim.request('POST', {}, { action: 'sync', since: 0, records: [], token: 'clave' }).ok, true);
  });

  test('archivo: lo hecho hace más de 90 días y lo borrado hace más de 60', () => {
    const sim = createGasSim();
    const now = Date.now();
    const a1 = sync(sim, 0, [
      row('todos', 'hecha-vieja', now - 100 * DAY, { title: 'x', done: true, doneAt: now - 100 * DAY }),
      row('todos', 'hecha-reciente', now - 10 * DAY, { title: 'y', done: true, doneAt: now - 10 * DAY }),
      row('todos', 'pendiente', now - 200 * DAY, { title: 'z', done: false }),
      row('items', 'borrado-viejo', now - 70 * DAY, {}, true),
      row('items', 'borrado-reciente', now - 5 * DAY, {}, true)
    ]);
    // Al día siguiente (simulado) toca limpiar.
    sim.props.set('lastPurge', '0');
    const a2 = sync(sim, a1.rev, []);
    assert.deepEqual(sim.sheetRows().slice(1).map((r) => r[1]).sort(), ['borrado-reciente', 'hecha-reciente', 'pendiente']);
    assert.deepEqual(sim.sheetRows('archivo').slice(1).map((r) => r[1]).sort(), ['borrado-viejo', 'hecha-vieja']);
    assert.equal(a2.full, true, 'quien no vio la limpieza recibe la lista completa');
    assert.deepEqual(a2.records.map((r) => r.id).sort(), ['borrado-reciente', 'hecha-reciente', 'pendiente']);
    assert.equal(sync(sim, a2.rev, []).full, false, 'después, otra vez incremental');
    // Solo una vez al día.
    assert.equal(sim.ctx.purgeIfDue_(sim.sheets.get('tareas_data')), 0);
  });

  test('resumen diario: texto', () => {
    const { ctx } = createGasSim();
    const today = '2026-10-30';
    const todos = [
      { id: '1', title: 'Fregar', dueDate: today, repeat: 'none' },
      { id: '2', title: 'Basura', dueDate: '2026-10-28', repeat: 'none', assignee: 'ana' },
      { id: '3', title: 'Platos', dueDate: '2026-10-25', repeat: '1d' }, // diaria: es de hoy
      { id: '4', title: 'Futura', dueDate: '2026-11-02', repeat: 'none' },
      { id: '5', title: 'Hecha', dueDate: today, repeat: 'none', done: true },
      { id: '6', title: 'Pausada', dueDate: today, repeat: '1w', paused: true }
    ];
    assert.equal(ctx.buildSummary_(todos, 'ana', today),
      '3 tareas (1 atrasada) · 1 para ti\n• Basura (tuya) · atrasada\n• Fregar\n• Platos');
    assert.equal(ctx.buildSummary_([todos[3], todos[4]], 'ana', today), '', 'sin nada para hoy no hay resumen');
    const many = Array.from({ length: 11 }, (_, i) => ({ id: 'm' + i, title: 'T' + i, dueDate: today, repeat: 'none' }));
    assert.match(ctx.buildSummary_(many, 'x', today), /… y 3 más$/);
  });

  test('resumen diario: a su hora, una vez al día, a su tema', () => {
    const sim = createGasSim();
    const tz = 'Europe/Madrid';
    const hourNow = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    const today = sim.ctx.Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const member = (hour) => row('members', 'ana', 1, { name: 'Ana', ntfyTopic: 'casa-ana-1', ntfyServer: 'https://ntfy.example.org', summaryHour: hour, tz, summaryTitle: 'Casa', summaryClick: 'https://app/' });
    sync(sim, 0, [member((hourNow + 1) % 24), row('todos', 't', 1, { title: 'Regar', dueDate: today, repeat: 'none' })]);
    assert.equal(sim.ctx.resumenDiario(), 0, 'no es su hora');
    sync(sim, 0, [member(hourNow)].map((m) => ({ ...m, updatedAt: 2 })));
    assert.equal(sim.ctx.resumenDiario(), 1);
    assert.equal(sim.ctx.resumenDiario(), 0, 'ya se envió hoy');
    const f = sim.fetches[0];
    assert.equal(f.url, 'https://ntfy.example.org/');
    assert.deepEqual([f.body.topic, f.body.title, f.body.click], ['casa-ana-1', 'Casa · hoy', 'https://app/']);
    assert.match(f.body.message, /^1 tarea\n• Regar$/);
    assert.equal(sim.ctx.enviarResumenAhora(), 1, 'enviarResumenAhora no mira la hora');
  });

  test('instalarResumenDiario: un solo activador y la app lo sabe', () => {
    const sim = createGasSim();
    assert.equal(sync(sim, 0, []).summary, false);
    sim.ctx.instalarResumenDiario();
    sim.ctx.instalarResumenDiario();
    assert.equal(sim.triggers.length, 1);
    assert.equal(sim.triggers[0].fn, 'resumenDiario');
    assert.equal(sync(sim, 0, []).summary, true);
  });
});

