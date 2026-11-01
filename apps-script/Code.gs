/**
 * Backend de sincronización y resumen diario para la PWA "Tareas".
 * Versión del script: 2 (la app avisa si el que tienes publicado es más antiguo).
 *
 * INSTALACIÓN (primera vez)
 * =========================
 * 1. Crea una Google Sheet nueva (hoja de cálculo en blanco).
 * 2. Menú: Extensiones → Apps Script.
 * 3. Borra el contenido del editor y pega TODO este archivo.
 * 4. AUTORIZA EL SCRIPT: elige la función instalarResumenDiario arriba y pulsa
 *    Ejecutar → Revisar permisos → tu cuenta → Configuración avanzada →
 *    Ir a … (no seguro) → Permitir. (Instala el resumen diario y autoriza el
 *    script; sin esto Google responde 403 "Acceso denegado" a la app.)
 * 5. Implementar → Nueva implementación → Tipo: "Aplicación web".
 *      - Ejecutar como: Yo (tu cuenta)
 *      - Quién tiene acceso: Cualquier usuario
 * 6. Copia la URL que termina en /exec y pégala en la app: Grupo → Compartir tareas.
 * 7. Invita a tu pareja desde la app (la invitación ya lleva la URL).
 *
 * ACTUALIZAR (ya lo tenías instalado)
 * ===================================
 * 1. Extensiones → Apps Script: borra todo y pega este archivo. Guarda.
 * 2. Ejecuta instalarResumenDiario y acepta los permisos nuevos (paso 4 de arriba).
 * 3. Implementar → Gestionar implementaciones → lápiz → Versión: "Nueva versión"
 *    → Implementar. La URL no cambia.
 *
 * SEGURIDAD (opcional): escribe una clave en SECRET y ponla también en el
 * campo "Clave secreta" de la app. Sin clave, cualquiera con la URL puede
 * leer/escribir; con clave, solo quien la conozca.
 *
 * Funciones que puedes ejecutar a mano desde el editor:
 *   instalarResumenDiario()  activa el resumen (lo comprueba cada hora).
 *   enviarResumenAhora()     envía ya el resumen a quien lo tenga activado (para probar).
 */

var SCRIPT_VERSION = 2;
var SHEET_NAME = 'tareas_data';
var ARCHIVE_NAME = 'archivo';
var SECRET = ''; // Opcional. Ej: 'mi-clave-familiar-2026'
var KEEP_DONE_DAYS = 90;    // Tareas hechas: pasan a la pestaña "archivo" después de estos días.
var KEEP_DELETED_DAYS = 60; // Borradas: igual.
var COLS = 6;               // store, id, updatedAt, deleted, json, rev
var DAY_MS = 24 * 3600 * 1000;

function doGet(e)  { return json_(handle_(e)); }
function doPost(e) { return json_(handle_(e)); }

/* Acciones:
 *  - sync (POST): {since, records} → guarda lo enviado y devuelve lo cambiado
 *    desde `since` (número de cambio, "rev"). Si el móvil lleva tanto sin
 *    sincronizar que se ha archivado algo desde entonces, devuelve todo (full).
 *  - pull / push: protocolo de la versión 1 (lo siguen usando las apps antiguas). */
function handle_(e) {
  var out;
  try {
    var params = (e && e.parameter) || {};
    var body = {};
    if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (err) {}
    }
    var action = body.action || params.action || 'pull';
    var token  = body.token  || params.token  || '';
    if (SECRET && token !== SECRET) {
      out = { ok: false, error: 'unauthorized' };
    } else {
      var sheet = getSheet_();
      if (action === 'sync') {
        out = sync_(sheet, body);
      } else if (action === 'pull') {
        out = { ok: true, records: readAll_(sheet).map(publicRow_) };
      } else if (action === 'push') {
        withLock_(function () { upsert_(sheet, body.records || []); });
        out = { ok: true, records: readAll_(sheet).map(publicRow_) };
      } else {
        out = { ok: false, error: 'accion desconocida' };
      }
      out.summary = PropertiesService.getScriptProperties().getProperty('summaryInstalled') === '1';
    }
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  out.version = SCRIPT_VERSION;
  return out;
}

function sync_(sheet, body) {
  var since = Number(body.since) || 0;
  var records = body.records || [];
  // Lo que acaba de enviar el móvil no se le devuelve.
  var sent = {};
  for (var i = 0; i < records.length; i++) sent[key_(records[i]) + '::' + (Number(records[i].updatedAt) || 0)] = true;
  var result;
  withLock_(function () {
    purgeIfDue_(sheet);
    upsert_(sheet, records);
    var props = PropertiesService.getScriptProperties();
    var rev = Number(props.getProperty('rev')) || 0;
    // Nunca devolver rev 0: el móvil lo tomaría como «primera vez» en cada sincronización.
    if (!rev) { rev = 1; props.setProperty('rev', '1'); }
    var purgeRev = Number(props.getProperty('purgeRev')) || 0;
    var full = since <= 0 || since < purgeRev;
    var rows = readAll_(sheet).filter(function (r) {
      if (!full && r.rev <= since) return false;
      return !sent[key_(r) + '::' + r.updatedAt];
    });
    result = { ok: true, rev: rev, full: full, records: rows.map(publicRow_) };
  });
  return result;
}

/* ------------------------------- Hoja -------------------------------- */

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['store', 'id', 'updatedAt', 'deleted', 'json', 'rev']);
  } else if (sheet.getRange(1, 6).getValue() !== 'rev') {
    sheet.getRange(1, 6).setValue('rev'); // Hoja de la versión 1: se añade la columna.
  }
  return sheet;
}

function getArchive_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ARCHIVE_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ARCHIVE_NAME);
    sheet.appendRow(['store', 'id', 'updatedAt', 'deleted', 'json', 'rev']);
  }
  return sheet;
}

function key_(r) { return r.store + '::' + r.id; }

function readAll_(sheet) {
  var values = sheet.getDataRange().getValues();
  var records = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[1]) continue;
    var data = {};
    try { data = JSON.parse(row[4] || '{}'); } catch (e) {}
    records.push({
      store: row[0],
      id: String(row[1]),
      updatedAt: Number(row[2]) || 0,
      deleted: row[3] === true || row[3] === 1 || row[3] === '1',
      data: data,
      rev: Number(row[5]) || 0
    });
  }
  return records;
}

function publicRow_(r) {
  return { store: r.store, id: r.id, updatedAt: r.updatedAt, deleted: r.deleted, data: r.data, rev: r.rev };
}

/* Guarda los registros más nuevos que los de la hoja (last-write-wins por
 * updatedAt) y numera cada cambio con un "rev" creciente. Llamar con el lock. */
function upsert_(sheet, records) {
  var props = PropertiesService.getScriptProperties();
  var rev = Number(props.getProperty('rev')) || 0;
  var values = sheet.getDataRange().getValues();
  var index = {};
  for (var i = 1; i < values.length; i++) {
    if (values[i][1]) index[values[i][0] + '::' + values[i][1]] = { row: i + 1, updatedAt: Number(values[i][2]) || 0 };
  }
  var toAppend = [];
  for (var j = 0; j < records.length; j++) {
    var r = records[j];
    var updatedAt = Number(r.updatedAt) || 0;
    var found = index[key_(r)];
    if (found && updatedAt <= found.updatedAt) continue; // Igual o más viejo: nada que guardar.
    rev++;
    var rowValues = [r.store, r.id, updatedAt, r.deleted ? 1 : 0, JSON.stringify(r.data || {}), rev];
    if (found && found.row > 0) {
      sheet.getRange(found.row, 1, 1, COLS).setValues([rowValues]);
      found.updatedAt = updatedAt;
    } else if (found) {
      toAppend[found.idx] = rowValues;
      found.updatedAt = updatedAt;
    } else {
      index[key_(r)] = { row: -1, idx: toAppend.length, updatedAt: updatedAt };
      toAppend.push(rowValues);
    }
  }
  if (toAppend.length) sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, COLS).setValues(toAppend);
  props.setProperty('rev', String(rev));
}

/* Archivo: como mucho una vez al día, las hechas antiguas y los borrados
 * antiguos pasan a la pestaña "archivo" (no se pierden, pero dejan de
 * sincronizarse). purgeRev marca el momento: un móvil que no lo haya visto
 * recibe la lista completa y quita lo que ya no está. */
function purgeIfDue_(sheet) {
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  if (now - (Number(props.getProperty('lastPurge')) || 0) < DAY_MS) return 0;
  props.setProperty('lastPurge', String(now));
  return purge_(sheet, now);
}

function purge_(sheet, now) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return 0;
  var doneLimit = now - KEEP_DONE_DAYS * DAY_MS;
  var deletedLimit = now - KEEP_DELETED_DAYS * DAY_MS;
  var keep = [], old = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i].slice(0, COLS);
    while (row.length < COLS) row.push('');
    if (!row[1]) continue;
    var deleted = row[3] === true || row[3] === 1 || row[3] === '1';
    var updatedAt = Number(row[2]) || 0;
    var archive = false;
    if (deleted) {
      archive = updatedAt < deletedLimit;
    } else if (row[0] === 'todos') {
      var data = {};
      try { data = JSON.parse(row[4] || '{}'); } catch (e) {}
      archive = !!data.done && (Number(data.doneAt) || updatedAt) < doneLimit;
    }
    (archive ? old : keep).push(row);
  }
  if (!old.length) return 0;
  var archiveSheet = getArchive_();
  archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, old.length, COLS).setValues(old);
  sheet.getRange(2, 1, values.length - 1, COLS).clearContent();
  if (keep.length) sheet.getRange(2, 1, keep.length, COLS).setValues(keep);
  var props = PropertiesService.getScriptProperties();
  var rev = (Number(props.getProperty('rev')) || 0) + 1;
  props.setProperty('rev', String(rev));
  props.setProperty('purgeRev', String(rev));
  return old.length;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* --------------------------- Resumen diario --------------------------- */
/* Cada persona activa el resumen en la app (Grupo → Avisos al móvil): su
 * miembro guarda summaryHour, tz, ntfyTopic, ntfyServer, summaryTitle y
 * summaryClick. Un activador horario envía, a esa hora y una vez al día, la
 * lista de lo pendiente para hoy a su tema de ntfy. Si no hay nada, no envía. */

function instalarResumenDiario() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'resumenDiario') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('resumenDiario').timeBased().everyHours(1).create();
  PropertiesService.getScriptProperties().setProperty('summaryInstalled', '1');
  getSheet_();
  Logger.log('Resumen diario instalado: se comprueba cada hora.');
}

function resumenDiario() { return enviarResumenes_(false); }

/** Envía ya el resumen a quien lo tenga activado, sin mirar la hora (para probar). */
function enviarResumenAhora() { return enviarResumenes_(true); }

function enviarResumenes_(force) {
  var rows = readAll_(getSheet_()).filter(function (r) { return !r.deleted; });
  var todos = rows.filter(function (r) { return r.store === 'todos'; })
    .map(function (r) { var t = r.data; t.id = r.id; return t; });
  var members = rows.filter(function (r) {
    var d = r.data;
    return r.store === 'members' && d.summaryHour !== null && d.summaryHour !== undefined && d.summaryHour !== '' && d.ntfyTopic;
  });
  var props = PropertiesService.getScriptProperties();
  var sent = 0;
  for (var i = 0; i < members.length; i++) {
    var m = members[i], d = m.data;
    var tz = d.tz || Session.getScriptTimeZone();
    var now = new Date();
    var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var hour = Number(Utilities.formatDate(now, tz, 'H'));
    var sentKey = 'summary:' + m.id;
    if (!force && (hour !== Number(d.summaryHour) || props.getProperty(sentKey) === today)) continue;
    var message = buildSummary_(todos, m.id, today);
    if (message) {
      UrlFetchApp.fetch((d.ntfyServer || 'https://ntfy.sh').replace(/\/+$/, '') + '/', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          topic: d.ntfyTopic,
          title: (d.summaryTitle || 'Tareas') + ' · hoy',
          message: message,
          tags: ['sunrise'],
          click: d.summaryClick || ''
        }),
        muteHttpExceptions: true
      });
      sent++;
    }
    if (!force) props.setProperty(sentKey, today);
  }
  return sent;
}

/** Texto del resumen: «4 tareas (2 atrasadas) · 1 para ti» + lista. '' si no hay nada. */
function buildSummary_(todos, memberId, today) {
  var list = [];
  for (var i = 0; i < todos.length; i++) {
    var t = todos[i];
    if (t.done || t.paused) continue;
    var due = todoDue_(t, today);
    if (due <= today) list.push({ t: t, due: due });
  }
  if (!list.length) return '';
  list.sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : String(a.t.title).localeCompare(String(b.t.title)); });
  var overdue = 0, mine = 0;
  for (var j = 0; j < list.length; j++) {
    if (list[j].due < today) overdue++;
    if (list[j].t.assignee === memberId) mine++;
  }
  var n = list.length;
  var head = n + (n === 1 ? ' tarea' : ' tareas')
    + (overdue ? ' (' + overdue + (overdue === 1 ? ' atrasada)' : ' atrasadas)') : '')
    + (mine ? ' · ' + mine + ' para ti' : '');
  var MAX = 8;
  var lines = list.slice(0, MAX).map(function (x) {
    return '• ' + x.t.title + (x.t.assignee === memberId ? ' (tuya)' : '') + (x.due < today ? ' · atrasada' : '');
  });
  if (n > MAX) lines.push('… y ' + (n - MAX) + ' más');
  return head + '\n' + lines.join('\n');
}

/* ------------- Fechas (copia de js/dates.js; las pruebas comparan ambas) ------------- */

var REPEAT_ALIASES_ = { daily: '1d', weekly: '1w', monthly: '1m', yearly: '1y' };

function parseRepeat_(repeat) {
  var m = /^(\d{1,3})([dwmy])(?::([1-7](?:,[1-7])*))?$/.exec(REPEAT_ALIASES_[repeat] || repeat || '');
  if (!m || Number(m[1]) <= 0 || (m[3] && m[2] !== 'w')) return null;
  var p = { n: Number(m[1]), unit: m[2] };
  if (m[3]) {
    var seen = {}, days = [];
    m[3].split(',').forEach(function (d) { if (!seen[d]) { seen[d] = true; days.push(Number(d)); } });
    p.days = days.sort(function (a, b) { return a - b; });
  }
  return p;
}
function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function dateOf_(key) { var a = key.split('-'); return new Date(Date.UTC(Number(a[0]), Number(a[1]) - 1, Number(a[2]))); }
function keyOf_(d) { return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate()); }
function addDays_(key, n) { var d = dateOf_(key); d.setUTCDate(d.getUTCDate() + n); return keyOf_(d); }
function addMonths_(key, n) {
  var d = dateOf_(key);
  var day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return keyOf_(d);
}
function isoDay_(key) { return ((dateOf_(key).getUTCDay() + 6) % 7) + 1; }
function step_(key, repeat) {
  var p = parseRepeat_(repeat);
  if (!p) return null;
  if (p.days) {
    var d = isoDay_(key);
    for (var i = 0; i < p.days.length; i++) if (p.days[i] > d) return addDays_(key, p.days[i] - d);
    return addDays_(key, 7 * p.n - (d - p.days[0]));
  }
  if (p.unit === 'd') return addDays_(key, p.n);
  if (p.unit === 'w') return addDays_(key, 7 * p.n);
  if (p.unit === 'm') return addMonths_(key, p.n);
  return addMonths_(key, 12 * p.n);
}
function currentDue_(dueDate, repeat, today) {
  if (!parseRepeat_(repeat) || dueDate >= today) return dueDate;
  var cur = dueDate;
  for (var next = step_(cur, repeat); next && next <= today; next = step_(cur, repeat)) cur = next;
  return cur;
}
function todoDue_(t, today) {
  var p = parseRepeat_(t.repeat);
  if (p && !p.days && t.repeatFrom === 'done') return t.dueDate;
  if (t.seriesDue && p) {
    if (t.dueDate >= today) return t.dueDate;
    var series = currentDue_(t.seriesDue, t.repeat, today);
    return series > t.dueDate ? series : t.dueDate;
  }
  return currentDue_(t.dueDate, t.repeat, today);
}
