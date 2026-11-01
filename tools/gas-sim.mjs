// Simulador de Google Apps Script: ejecuta el Code.gs REAL en Node (vm) con
// imitaciones mínimas de SpreadsheetApp, PropertiesService, LockService,
// ContentService, Utilities, UrlFetchApp, ScriptApp y Logger.
// Lo usan tools/test.mjs (lógica del script) y tools/smoke.mjs (Web App simulado).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Hoja en memoria: filas como arrays (la 0 es la cabecera). */
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  width() { return Math.max(1, ...this.rows.map((r) => r.length)); }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].some((v) => v !== '' && v != null)) return i + 1;
    return 0;
  }
  appendRow(values) { this.rows.splice(this.getLastRow(), 0, [...values]); }
  getDataRange() {
    const n = this.getLastRow(), w = this.width();
    return { getValues: () => this.rows.slice(0, n).map((r) => Array.from({ length: w }, (_, j) => (r[j] ?? ''))) };
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    const cell = (i, j) => {
      while (this.rows.length < row + i) this.rows.push([]);
      return this.rows[row - 1 + i];
    };
    return {
      getValue: () => (this.rows[row - 1] || [])[col - 1] ?? '',
      setValue: (v) => { cell(0)[col - 1] = v; },
      setValues: (vals) => { vals.forEach((r, i) => r.forEach((v, j) => { cell(i)[col - 1 + j] = v; })); },
      clearContent: () => { for (let i = 0; i < numRows; i++) for (let j = 0; j < numCols; j++) cell(i)[col - 1 + j] = ''; }
    };
  }
}

function formatDate(date, tz, fmt) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map((p) => [p.type, p.value]));
  if (fmt === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
  if (fmt === 'H') return String(Number(parts.hour));
  throw new Error('formato no simulado: ' + fmt);
}

/**
 * @param {{source?: string, timeZone?: string}} opts  source: ruta del .gs relativa a la raíz.
 */
export function createGasSim({ source = 'apps-script/Code.gs', timeZone = 'Europe/Madrid' } = {}) {
  const sheets = new Map();
  const props = new Map();
  const fetches = [];
  const triggers = [];
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets.get(n) || null,
        insertSheet: (n) => { const s = new FakeSheet(n); sheets.set(n, s); return s; }
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s })
    },
    Utilities: { formatDate },
    Session: { getScriptTimeZone: () => timeZone },
    UrlFetchApp: {
      fetch: (url, opts) => { fetches.push({ url, ...opts, body: JSON.parse(opts.payload) }); return { getResponseCode: () => 200 }; }
    },
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: (fn) => ({ timeBased: () => ({ everyHours: (h) => ({ create: () => { const t = { fn, h, getHandlerFunction: () => fn }; triggers.push(t); return t; } }) }) })
    },
    Logger: { log() {} },
    JSON, Date, Math, Number, String, Object, Array, RegExp, Error
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, source), 'utf8'), ctx, { filename: source });

  /** Petición al Web App como la haría la app (GET con parámetros o POST con cuerpo JSON). */
  function request(method, params = {}, body = null) {
    const e = { parameter: params, postData: body ? { contents: JSON.stringify(body) } : undefined };
    const out = method === 'GET' ? ctx.doGet(e) : ctx.doPost(e);
    return JSON.parse(out.getContent());
  }
  const sheetRows = (name = 'tareas_data') => (sheets.get(name) ? sheets.get(name).getDataRange().getValues() : []);
  return { ctx, request, sheets, sheetRows, props, fetches, triggers };
}
