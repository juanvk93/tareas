/**
 * Backend de sincronización para la PWA "Tareas".
 *
 * INSTALACIÓN
 * ===========
 * 1. Crea una Google Sheet nueva (hoja de cálculo en blanco).
 * 2. Menú: Extensiones → Apps Script.
 * 3. Borra el contenido del editor y pega TODO este archivo.
 * 4. AUTORIZA EL SCRIPT: elige la función doGet arriba y pulsa Ejecutar →
 *    Revisar permisos → tu cuenta → Configuración avanzada → Ir a … → Permitir.
 *    (Sin esto Google responde 403 "Acceso denegado" a la app.)
 * 5. Implementar → Nueva implementación → Tipo: "Aplicación web".
 *      - Ejecutar como: Yo (tu cuenta)
 *      - Quién tiene acceso: Cualquier usuario
 * 6. Copia la URL que termina en /exec y pégala en la app: Grupo → Compartir tareas.
 * 7. Invita a tu pareja desde la app (la invitación ya lleva la URL).
 *
 * SEGURIDAD (opcional): escribe una clave en SECRET y ponla también en el
 * campo "Clave secreta" de la app. Sin clave, cualquiera con la URL puede
 * leer/escribir; con clave, solo quien la conozca.
 */

var SHEET_NAME = 'tareas_data';
var SECRET = ''; // Opcional. Ej: 'mi-clave-familiar-2026'

function doGet(e)  { return handle_(e); }
function doPost(e) { return handle_(e); }

function handle_(e) {
  var out = { ok: false };
  try {
    var params = (e && e.parameter) || {};
    var body = {};
    if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (err) {}
    }
    var action = body.action || params.action || 'pull';
    var token  = body.token  || params.token  || '';
    if (SECRET && token !== SECRET) return json_({ ok: false, error: 'unauthorized' });

    var sheet = getSheet_();
    if (action === 'pull') {
      out = { ok: true, records: readAll_(sheet) };
    } else if (action === 'push') {
      upsert_(sheet, body.records || []);
      out = { ok: true, records: readAll_(sheet) };
    } else {
      out = { ok: false, error: 'accion desconocida' };
    }
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return json_(out);
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['store', 'id', 'updatedAt', 'deleted', 'json']);
  }
  return sheet;
}

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
      data: data
    });
  }
  return records;
}

function upsert_(sheet, records) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var values = sheet.getDataRange().getValues();
    var index = {};
    for (var i = 1; i < values.length; i++) {
      index[values[i][0] + '::' + values[i][1]] = { row: i + 1, updatedAt: Number(values[i][2]) || 0 };
    }
    var toAppend = [];
    for (var j = 0; j < records.length; j++) {
      var r = records[j];
      var rowValues = [r.store, r.id, Number(r.updatedAt) || 0, r.deleted ? 1 : 0, JSON.stringify(r.data || {})];
      var found = index[r.store + '::' + r.id];
      if (found && found.row > 0) {
        if ((Number(r.updatedAt) || 0) >= found.updatedAt) {
          sheet.getRange(found.row, 1, 1, 5).setValues([rowValues]);
        }
      } else if (!found) {
        toAppend.push(rowValues);
        index[r.store + '::' + r.id] = { row: -1, updatedAt: 0 };
      }
    }
    if (toAppend.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, 5).setValues(toAppend);
    }
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
