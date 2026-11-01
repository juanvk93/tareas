/* Diagnóstico: estado de cada grupo, últimos errores e informe para copiar. */
import * as db from '../db.js';
import { APP_VERSION } from '../changelog.js';
import { icon } from '../icons.js';
import { queueSize } from '../notify.js';
import { readLog, clearLog, maskUrl, maskSecret, KINDS } from '../diag.js';
import { state } from '../state.js';
import { $, esc, toast, openModal, closeModal } from '../ui.js';

const KIND_ICON = { sync: 'refresh', ntfy: 'bell', js: 'alert', sw: 'download' };
const stamp = (ts) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ts).replace(',', '');

/** Último error de sincronización de un grupo, si es posterior a la última correcta. */
function failingSince(g, log) {
  const err = log.find((e) => e.kind === 'sync' && e.level === 'error' && e.group === g.name);
  return err && err.at > (g.lastSyncAt || 0) ? err : null;
}

function syncStatus(g, log) {
  if (!g.syncUrl) return { dot: 'off', text: 'Google Sheets sin conectar' };
  const err = failingSince(g, log);
  if (err) return { dot: 'err', text: `Falla desde ${stamp(err.at)}: ${err.message}` };
  return g.lastSyncAt
    ? { dot: 'ok', text: `Sincronización correcta (${stamp(g.lastSyncAt)})` }
    : { dot: 'off', text: 'Aún no ha sincronizado' };
}

const detailLines = (d) => d ? Object.entries(d).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n') : '';

async function environment() {
  return {
    'Versión': APP_VERSION,
    'Conexión': navigator.onLine ? 'sí' : 'no',
    'Service Worker': navigator.serviceWorker?.controller ? 'activo' : 'no controla la página',
    'Almacenamiento persistente': (await navigator.storage?.persisted?.().catch(() => false)) ? 'sí' : 'no',
    'Avisos en cola': String(await queueSize())
  };
}

/** Informe de texto para pegar en un mensaje: sin URLs completas, claves ni temas. */
/** Avisos de este móvil en un grupo: los recibe tu miembro (su tema). */
function notifyText(g, me) {
  if (g.personal) return 'sin avisos (grupo privado)';
  return me && me.notify && me.ntfyTopic ? `recibes avisos · ${me.ntfyServer || g.ntfyServer || 'https://ntfy.sh'} · tu tema ${maskSecret(me.ntfyTopic)}` : 'no recibes avisos';
}

function buildReport(env, log, mine) {
  const out = [`Tareas v${APP_VERSION} · informe de diagnóstico`, `Fecha: ${new Date().toLocaleString('es-ES')}`, `Navegador: ${navigator.userAgent}`];
  for (const [k, v] of Object.entries(env)) if (k !== 'Versión') out.push(`${k}: ${v}`);
  out.push('', 'Grupos:');
  for (const g of state.settings.groups) {
    out.push(`- ${g.name} (${g.personal ? 'privado' : 'compartido'})`);
    out.push(`  Sheets: ${g.syncUrl ? `${maskUrl(g.syncUrl)} · script v${g.scriptVersion || '?'} · rev ${g.syncRev || 0}` : 'sin conectar'} · clave: ${g.syncSecret ? 'sí' : 'no'} · auto: ${g.autoSync ? 'sí' : 'no'} · ${syncStatus(g, log).text}`);
    out.push(`  Avisos: ${notifyText(g, mine[g.id])}`);
  }
  out.push('', `Eventos (${log.length}):`);
  for (const e of log) {
    out.push(`[${stamp(e.at)}] ${KINDS[e.kind] || e.kind}${e.group ? ' · ' + e.group : ''}${e.count > 1 ? ` · ×${e.count}` : ''}${e.level === 'info' ? ' (info)' : ''}: ${e.message}`);
    const d = detailLines(e.detail);
    if (d) out.push(d.split('\n').map((l) => '    ' + l).join('\n'));
  }
  return out.join('\n');
}

export async function openDiagModal() {
  const log = await readLog();
  const env = await environment();
  const groups = state.settings.groups;
  const mine = Object.fromEntries(await Promise.all(groups.map(async (g) => [g.id, g.currentMemberId ? await db.getOne('members', g.currentMemberId) : null])));

  openModal('Diagnóstico', `
    <div class="diag-env">
      ${Object.entries(env).map(([k, v]) => `<div><span class="muted">${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
    </div>
    ${groups.length ? `<div class="section-title"><h2>Grupos</h2></div>
    <div class="card diag-groups">
      ${groups.map((g) => {
        const st = syncStatus(g, log);
        return `<div class="diag-group">
          <div class="list-item__title">${icon(g.personal ? 'lock' : 'users')} ${esc(g.name)}</div>
          <div class="sync-status"><span class="sync-dot sync-dot--${st.dot}"></span><span>${esc(st.text)}</span></div>
          <div class="muted text-sm">Avisos: ${esc(notifyText(g, mine[g.id]).split(' · ')[0])}</div>
        </div>`;
      }).join('')}
    </div>` : ''}
    <div class="section-title"><h2>Últimos eventos</h2></div>
    <div class="diag-log" id="diag-log">
      ${log.length ? log.map((e) => `
        <div class="diag-ev diag-ev--${e.level}">
          <div class="diag-ev__head">${icon(KIND_ICON[e.kind] || 'alert')}<span>${esc(KINDS[e.kind] || e.kind)}${e.group ? ' · ' + esc(e.group) : ''}</span>
            <span class="diag-ev__when">${e.count > 1 ? `×${e.count} · ` : ''}${stamp(e.at)}</span></div>
          <div class="diag-ev__msg">${esc(e.message)}</div>
          ${e.detail ? `<details><summary>Detalle</summary><pre>${esc(detailLines(e.detail))}</pre></details>` : ''}
        </div>`).join('') : `<p class="help center">${icon('check')} Sin incidencias registradas.</p>`}
    </div>
    <details class="diag-report"><summary>Ver informe completo</summary>
      <textarea class="input" id="diag-report" readonly rows="8"></textarea>
    </details>
    <p class="help">El informe no incluye las URLs completas, la clave secreta ni los temas de ntfy.</p>
    <div class="modal__actions">
      <button class="btn btn--danger" id="diag-clear" ${log.length ? '' : 'disabled'}>${icon('trash')}Borrar</button>
      <button class="btn btn--primary" id="diag-copy">${icon('copy')}Copiar informe</button>
    </div>
  `, {
    wide: true,
    onMount(modal) {
      const report = buildReport(env, log, mine);
      $('#diag-report', modal).value = report;
      $('#diag-copy', modal).onclick = async () => {
        try { await navigator.clipboard.writeText(report); toast('Informe copiado', 'ok'); }
        catch { $('.diag-report', modal).open = true; $('#diag-report', modal).select(); toast('Cópialo desde «Ver informe completo»', 'err'); }
      };
      $('#diag-clear', modal).onclick = async () => {
        await clearLog();
        closeModal();
        toast('Registro borrado');
      };
    }
  });
}
