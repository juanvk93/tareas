/* Vista Grupo: tipo, miembros, invitación, Google Sheets, avisos y salir. */
import * as db from '../db.js';
import { testConnection, checkSyncUrl, REQUIRED_SCRIPT_VERSION } from '../sync.js';
import { icon } from '../icons.js';
import { testNotify, isValidTopic, subscribeLink, appUrl } from '../notify.js';
import { state, G } from '../state.js';
import { $, $$, view, esc, fmtTime, relativeDay, fmtShortDay, toast, confirmDialog, avatar, promptText } from '../ui.js';
import { scheduleAutoSync, doSync } from '../sync-ui.js';
import { refresh } from '../nav.js';
import { shareInvite, leaveGroup, memberTopic } from '../groups.js';
import { openGuideModal, openNotifyGuideModal } from '../modals/guides.js';
import { openDiagModal } from '../modals/diag.js';
import { logEvent } from '../diag.js';
import { todayKey, addDays, isRepeating, parseYmd } from '../dates.js';

export async function renderGrupo() {
  const g = G();
  const personal = g.personal;
  const members = (await db.members(g.id)).sort((a, b) => (a.id === g.currentMemberId ? -1 : b.id === g.currentMemberId ? 1 : a.name.localeCompare(b.name)));
  const lastSync = g.lastSyncAt ? `${relativeDay(g.lastSyncAt)} ${fmtTime(g.lastSyncAt)}` : 'Nunca';
  const me = members.find((m) => m.id === g.currentMemberId) || {};
  const others = members.filter((m) => m.id !== me.id);
  const myNotify = !!me.notify && isValidTopic(me.ntfyTopic);
  const myServer = me.ntfyServer || g.ntfyServer || 'https://ntfy.sh';
  const mySummary = me.summaryHour !== null && me.summaryHour !== undefined && me.summaryHour !== '' && isValidTopic(me.ntfyTopic);
  const oldScript = g.syncUrl && g.scriptVersion && g.scriptVersion < REQUIRED_SCRIPT_VERSION;
  const summaryStatus = !g.syncUrl ? 'Necesita Google Sheets conectado: el resumen lo envía tu script de Google.'
    : oldScript || !g.scriptVersion ? 'Hace falta la versión nueva del script de Google.'
    : !g.summaryInstalled ? 'Falta un paso: en Apps Script ejecuta una vez «instalarResumenDiario».'
    : `Te llegará cada día a las ${me.summaryHour}:00 si hay algo pendiente.`;
  const summaryReady = g.syncUrl && !oldScript && g.scriptVersion && g.summaryInstalled;
  const save = async (patch) => { state.settings = await db.updateGroup(g.id, patch); };
  // Vacaciones: hasta cuándo están en pausa las repetidas (la fecha más lejana).
  const today = todayKey();
  const groupTodos = await db.todos(g.id);
  const vacation = groupTodos.filter((t) => !t.done && t.pausedUntil && t.pausedUntil > today);
  const vacationUntil = vacation.reduce((m, t) => (t.pausedUntil > m ? t.pausedUntil : m), '');
  const repeating = groupTodos.filter((t) => !t.done && !t.paused && isRepeating(t.repeat)).length;

  view().innerHTML = `
    <div class="card group-head">
      <div class="group-head__logo">${icon(personal ? 'lock' : 'users')}</div>
      <div class="list-item__body">
        <div class="group-head__name">${esc(g.name)}</div>
        <div class="muted text-sm">${personal ? 'Privado · solo tú' : `Compartido · ${members.length} miembro${members.length === 1 ? '' : 's'}`}</div>
      </div>
      <button class="icon-btn" id="btn-rename" aria-label="Cambiar nombre del grupo">${icon('edit')}</button>
    </div>

    <!-- Tipo de grupo -->
    <div class="section-title"><h2>Tipo de grupo</h2></div>
    <div class="card">
      <div class="segment segment--block" id="set-type">
        <button data-type="shared" class="${personal ? '' : 'is-active'}">${icon('users')}Compartido</button>
        <button data-type="private" class="${personal ? 'is-active' : ''}">${icon('lock')}Privado</button>
      </div>
      <p class="help mb-0">${personal
        ? 'Solo tú ves estas tareas: sin miembros ni invitaciones.'
        : 'Compartes estas tareas con otras personas. Invítalas desde aquí abajo.'}</p>
    </div>

    ${personal ? '' : `
    <!-- Miembros -->
    <div class="section-title"><h2>Miembros</h2></div>
    <div class="card card--pad0"><div class="list">
      ${members.map((m) => `
        <div class="list-item">
          ${avatar(m, 'lg')}
          <div class="list-item__body"><div class="list-item__title">${esc(m.name)}</div>
            ${m.id === g.currentMemberId ? '<div class="list-item__sub">Tú, en este móvil</div>' : ''}</div>
          ${m.id === g.currentMemberId
            ? `<button class="delete-x" id="btn-me-edit" aria-label="Cambiar tu nombre">${icon('edit')}</button>`
            : `<button class="delete-x" data-del-member="${esc(m.id)}" aria-label="Quitar del grupo">${icon('x')}</button>`}
        </div>`).join('')}
    </div></div>
    <button class="btn btn--primary btn--block" id="btn-invite" style="margin-bottom:6px">${icon('share')}Invitar a alguien</button>
    <p class="help" style="margin-bottom:22px">Envía la invitación a tu pareja por WhatsApp o similar. Al abrirla, escribirá su nombre y aparecerá aquí.</p>`}

    <!-- Sincronización -->
    <div class="section-title"><h2>${personal ? 'Copia en Google Sheets (opcional)' : 'Compartir tareas (Google Sheets)'}</h2></div>
    <div class="card">
      <div class="sync-status" style="margin-bottom:12px">
        <span class="sync-dot ${g.syncUrl ? 'sync-dot--ok' : 'sync-dot--off'}"></span>
        <span>${g.syncUrl ? 'Conectado · Última: ' + esc(lastSync) + (g.scriptVersion ? ` · script v${g.scriptVersion}` : '') : 'Sin conectar: las tareas solo están en este móvil'}</span>
      </div>
      ${oldScript ? `<div class="warn-box">${icon('alert')}<div><b>Tu script de Google es antiguo.</b> Sigue sincronizando, pero envía todo cada vez y no tiene resumen diario.
        <button class="btn btn--sm" id="btn-script-update" style="margin-top:8px">Cómo actualizarlo</button></div></div>` : ''}
      ${personal ? '<p class="help" style="margin:-4px 0 12px">Úsalo si quieres tus tareas en varios dispositivos o como copia de seguridad. Usa una hoja distinta a la de tus otros grupos.</p>' : ''}
      <div class="field"><label>URL del Web App (Google Apps Script)</label>
        <input class="input" id="set-url" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(g.syncUrl)}" autocapitalize="off" spellcheck="false">
      </div>
      <div class="field"><label>Clave secreta (opcional)</label>
        <input class="input" id="set-secret" placeholder="Debe coincidir con SECRET del script" value="${esc(g.syncSecret)}" autocapitalize="off" spellcheck="false">
      </div>
      <div class="field">
        <label class="flex-between" style="cursor:pointer">
          <span>Sincronizar automáticamente</span>
          <input type="checkbox" id="set-autosync" ${g.autoSync ? 'checked' : ''} class="switch">
        </label>
      </div>
      <div class="row" style="margin-bottom:10px">
        <button class="btn" id="btn-test">Probar</button>
        <button class="btn btn--primary" id="btn-savesync">Guardar</button>
      </div>
      <button class="btn btn--ghost btn--block btn--sm" id="btn-guide">${icon('book')}Cómo configurar Google Sheets</button>
    </div>

    <!-- Notificaciones: cada persona tiene su tema; los avisos van a los demás. -->
    <div class="section-title"><h2>Avisos al móvil</h2></div>
    <div class="card">
      ${personal ? `<p class="help" style="margin:0 0 12px">En un grupo privado no hay avisos al añadir o resolver: los cambios los haces tú.</p>` : `
      <label class="toggle-row">
        <span class="toggle-row__text">
          <span class="toggle-row__title">${icon('bell')}Recibir avisos en este móvil</span>
          <span class="help">Cuando otra persona añade o resuelve una tarea. Lo que haces tú no te avisa.</span>
        </span>
        <input type="checkbox" id="set-notify" ${myNotify ? 'checked' : ''} class="switch">
      </label>`}
      <label class="toggle-row">
        <span class="toggle-row__text">
          <span class="toggle-row__title">${icon('sun')}Resumen diario</span>
          <span class="help">Cada día, a la hora que elijas, lo pendiente para hoy. Si no hay nada, no llega.</span>
        </span>
        <input type="checkbox" id="set-summary" ${mySummary ? 'checked' : ''} class="switch">
      </label>
      ${mySummary ? `<div class="summary-config">
        <div class="flex-between"><label for="set-summary-hour">Hora</label>
          <select class="select" id="set-summary-hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === Number(me.summaryHour) ? 'selected' : ''}>${h}:00</option>`).join('')}</select></div>
        <p class="help summary-status ${summaryReady ? '' : 'summary-status--warn'}">${esc(summaryStatus)}</p>
        ${g.syncUrl && !summaryReady ? `<button class="btn btn--sm btn--block" id="btn-summary-help">Cómo hacerlo</button>` : ''}
      </div>` : ''}
      ${myNotify || mySummary ? `
      <div class="notify-config">
        <a class="btn btn--primary btn--block" id="btn-subscribe" href="${esc(subscribeLink(myServer, me.ntfyTopic, g.name))}">${icon('bell')}Suscribirme en la app ntfy</a>
        <p class="help">Abre la app ntfy (Android) y se suscribe a tu tema. Si no la tienes, instálala y vuelve a pulsar.</p>
        <div class="row" style="margin-bottom:10px">
          <button class="btn" id="btn-notify-test">${icon('send')}Probar</button>
          <button class="btn" id="btn-notify-guide">${icon('book')}Ayuda</button>
        </div>
        <details class="notify-advanced">
          <summary>Tu tema y servidor</summary>
          <div class="field" style="margin-top:10px"><label>Tu tema de ntfy</label>
            <div class="input-group">
              <input class="input" id="set-topic" value="${esc(me.ntfyTopic)}" autocapitalize="off" autocomplete="off" spellcheck="false">
              <button class="btn" id="btn-topic-gen" title="Generar tema nuevo" aria-label="Generar tema nuevo">${icon('key')}</button>
            </div>
            <p class="help">Es solo tuyo. Quien lo conozca puede leer tus avisos: no lo publiques.</p>
          </div>
          <div class="field"><label>Servidor ntfy</label>
            <input class="input" id="set-ntfy-server" placeholder="https://ntfy.sh" value="${esc(myServer)}" autocapitalize="off" spellcheck="false">
          </div>
          <button class="btn btn--block" id="btn-notify-save">Guardar</button>
        </details>
      </div>` : ''}
      ${personal ? '' : `<div class="notify-who">${others.length ? others.map((m) => `<span class="notify-who__item">${avatar(m, 'xs')}${esc(m.name)}: ${m.notify && isValidTopic(m.ntfyTopic) ? 'recibe avisos' : 'sin avisos'}</span>`).join('') : '<span class="help">Cuando alguien se una, aquí verás si recibe avisos.</span>'}</div>`}
    </div>

    <!-- Tareas sin hacer -->
    <div class="section-title"><h2>Tareas sin hacer</h2></div>
    <div class="card">
      <label class="toggle-row">
        <span class="toggle-row__text">
          <span class="toggle-row__title">${icon('history')}Pasan a hoy</span>
          <span class="help">Las que no se repiten y se quedaron sin hacer salen como de hoy (con «desde …») en vez de como atrasadas. Solo en este móvil.</span>
        </span>
        <input type="checkbox" id="set-rollover" ${g.rollOver ? 'checked' : ''} class="switch">
      </label>
    </div>

    <!-- Vacaciones -->
    <div class="section-title"><h2>Vacaciones</h2></div>
    <div class="card">
      ${vacationUntil ? `
      <div class="sync-status" style="margin-bottom:12px">${icon('pause')}
        <span>${vacation.length} ${vacation.length === 1 ? 'tarea repetida en pausa' : 'tareas repetidas en pausa'} hasta el ${esc(fmtShortDay(parseYmd(vacationUntil)))}</span></div>
      <button class="btn btn--block" id="btn-vacation-end">${icon('play')}Reanudar ya</button>` : `
      <div class="field"><label>Pausar todas las tareas que se repiten hasta el</label>
        <input class="input" type="date" id="vacation-until" min="${addDays(today, 1)}" value="${addDays(today, 7)}">
      </div>
      <button class="btn btn--block" id="btn-vacation" ${repeating ? '' : 'disabled'}>${icon('pause')}Pausar repeticiones</button>
      <p class="help">${repeating ? `Afecta a ${repeating} ${repeating === 1 ? 'tarea' : 'tareas'}${personal ? '' : ' para todo el grupo'}. Vuelven solas el primer día que les toque; las que no se repiten no cambian.` : 'No hay tareas que se repitan.'}</p>`}
    </div>

    <button class="btn btn--danger btn--block" id="btn-leave" style="margin-top:8px">${icon(personal ? 'trash' : 'logout')}${personal ? 'Eliminar grupo' : 'Salir del grupo'}</button>
  `;

  // --- Grupo y miembros ---
  $('#btn-rename').onclick = () => promptText('Nombre del grupo', g.name, 40, async (v) => {
    await save({ name: v });
    toast(personal ? 'Nombre cambiado' : 'Nombre cambiado. Reenvía la invitación si quieres que lo vean igual.', 'ok');
    await refresh();
  });
  const meEdit = $('#btn-me-edit');
  if (meEdit) meEdit.onclick = async () => {
    const me = await db.getOne('members', g.currentMemberId);
    promptText('Tu nombre', me ? me.name : '', 30, async (v) => {
      await db.updateMember(g.currentMemberId, { name: v });
      state.settings = await db.saveSettings({ myName: v });
      scheduleAutoSync(); await renderGrupo();
    });
  };
  $$('[data-del-member]').forEach((b) => b.onclick = async () => {
    const m = members.find((x) => x.id === b.dataset.delMember);
    if (await confirmDialog(`¿Quitar a ${m.name} del grupo? Sus tareas resueltas se conservan.`, { danger: true, okText: 'Quitar' })) {
      await db.deleteMember(m.id); scheduleAutoSync(); await renderGrupo();
    }
  });
  $$('[data-type]').forEach((b) => b.onclick = async () => {
    const toPrivate = b.dataset.type === 'private';
    if (toPrivate === personal) return;
    if (toPrivate && members.length > 1 && !await confirmDialog(
      `«${g.name}» tiene ${members.length} miembros. Al hacerlo privado dejarás de ver miembros e invitaciones en este móvil, pero quien ya esté dentro seguirá viendo las tareas mientras uséis la misma Google Sheet. ¿Continuar?`,
      { okText: 'Hacer privado' })) return;
    await save({ personal: toPrivate });
    toast(toPrivate ? 'Ahora es un grupo privado' : 'Ahora es un grupo compartido: ya puedes invitar a alguien', 'ok');
    await refresh();
  });
  const inviteBtn = $('#btn-invite');
  if (inviteBtn) inviteBtn.onclick = shareInvite;
  $('#btn-leave').onclick = leaveGroup;

  $('#set-rollover').onchange = async (e) => {
    await save({ rollOver: e.target.checked });
    toast(e.target.checked ? 'Las tareas sin hacer pasan a hoy' : 'Las tareas sin hacer salen como atrasadas');
  };

  // --- Vacaciones ---
  const vacBtn = $('#btn-vacation');
  if (vacBtn) vacBtn.onclick = async () => {
    const until = $('#vacation-until').value;
    if (!until || until <= today) return toast('Elige un día a partir de mañana', 'err');
    const n = await db.pauseGroupRepeats(g.id, until);
    scheduleAutoSync();
    toast(`${n} ${n === 1 ? 'tarea en pausa' : 'tareas en pausa'} hasta el ${fmtShortDay(parseYmd(until))}`, 'ok');
    await renderGrupo();
  };
  const vacEnd = $('#btn-vacation-end');
  if (vacEnd) vacEnd.onclick = async () => {
    const n = await db.resumeGroupRepeats(g.id);
    scheduleAutoSync();
    toast(`${n} ${n === 1 ? 'tarea reanudada' : 'tareas reanudadas'}`, 'ok');
    await renderGrupo();
  };

  // --- Sincronización ---
  $('#btn-test').onclick = async () => {
    const url = $('#set-url').value.trim();
    if (!url) return toast('Introduce la URL', 'err');
    toast('Probando…');
    try { const r = await testConnection(url, $('#set-secret').value.trim()); toast(`Conexión correcta · ${r.count} registros · script v${r.version}${r.version < REQUIRED_SCRIPT_VERSION ? ' (antiguo)' : ''}`, 'ok'); }
    catch (e) {
      logEvent({ kind: 'sync', group: g.name, message: 'Prueba de conexión: ' + e.message, detail: e.detail });
      toast('Error: ' + e.message, 'err', { action: { label: 'Detalles', fn: openDiagModal } });
    }
  };
  $('#btn-savesync').onclick = async () => {
    const url = $('#set-url').value.trim();
    const other = url && state.settings.groups.find((x) => x.id !== g.id && x.syncUrl === url);
    if (other) return toast(`Esa hoja ya la usa «${other.name}». Cada grupo necesita la suya.`, 'err');
    const bad = url && checkSyncUrl(url);
    if (bad) return toast(bad, 'err');
    // Hoja nueva: la sincronización incremental vuelve a empezar (se envía todo).
    const reset = url !== g.syncUrl ? { syncRev: 0, pushedAt: 0, scriptVersion: 0, summaryInstalled: false } : {};
    await save({ syncUrl: url, syncSecret: $('#set-secret').value.trim(), autoSync: $('#set-autosync').checked, ...reset });
    await renderGrupo();
    if (url) await doSync(false, g.id);
  };
  $('#set-autosync').onchange = (e) => save({ autoSync: e.target.checked });
  $('#btn-guide').onclick = openGuideModal;

  // --- Notificaciones (tu tema, en tu miembro: se sincroniza para que los demás sepan dónde avisarte) ---
  const saveMe = async (patch) => { await db.updateMember(me.id, patch); scheduleAutoSync(); };
  const topicPatch = () => (isValidTopic(me.ntfyTopic) ? {} : { ntfyTopic: memberTopic(g.name, me.name) });
  const upd = $('#btn-script-update');
  if (upd) upd.onclick = () => openGuideModal({ update: true });
  // Resumen diario: lo envía Code.gs a la hora elegida (en la zona horaria de este móvil).
  const summaryFields = (hour) => ({
    summaryHour: hour, tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    summaryTitle: g.name, summaryClick: appUrl(), ntfyServer: myServer
  });
  $('#set-summary').onchange = async (e) => {
    const on = e.target.checked;
    await saveMe(on ? { ...topicPatch(), ...summaryFields(8) } : { summaryHour: null });
    await renderGrupo();
    toast(on ? 'Resumen diario activado a las 8:00' : 'Resumen diario desactivado', on ? 'ok' : '');
  };
  const hourSel = $('#set-summary-hour');
  if (hourSel) hourSel.onchange = async () => { await saveMe(summaryFields(Number(hourSel.value))); toast(`Resumen a las ${hourSel.value}:00`, 'ok'); await renderGrupo(); };
  const sumHelp = $('#btn-summary-help');
  if (sumHelp) sumHelp.onclick = () => openGuideModal({ update: true });
  const notifyToggle = $('#set-notify');
  if (notifyToggle) notifyToggle.onchange = async (e) => {
    const on = e.target.checked;
    await saveMe(on ? { notify: true, ...topicPatch() } : { notify: false });
    await renderGrupo();
    if (on) toast('Avisos activados: pulsa «Suscribirme en la app ntfy»', 'ok');
    else toast('Ya no recibirás avisos en este móvil');
  };
  if (!myNotify && !mySummary) return;
  const readNotifyForm = () => ({
    ntfyTopic: $('#set-topic').value.trim(),
    ntfyServer: $('#set-ntfy-server').value.trim() || 'https://ntfy.sh'
  });
  $('#btn-topic-gen').onclick = async () => {
    if (!await confirmDialog('Si cambias tu tema tendrás que volver a suscribirte en ntfy. ¿Generar uno nuevo?', { okText: 'Generar' })) return;
    await saveMe({ ntfyTopic: memberTopic(g.name, me.name) });
    toast('Tema nuevo: vuelve a pulsar «Suscribirme»', 'ok');
    await renderGrupo();
  };
  $('#btn-notify-save').onclick = async () => {
    const f = readNotifyForm();
    if (!isValidTopic(f.ntfyTopic)) return toast('El tema no es válido (letras, números, - y _)', 'err');
    await saveMe({ ntfyTopic: f.ntfyTopic, ntfyServer: f.ntfyServer });
    toast('Guardado', 'ok');
    await renderGrupo();
  };
  // La prueba va a TU tema: así compruebas que estás bien suscrito.
  $('#btn-notify-test').onclick = async () => {
    try { await testNotify(myServer, me.ntfyTopic, g.name); toast('Aviso de prueba enviado: debería llegarte ahora', 'ok'); }
    catch (e) {
      logEvent({ kind: 'ntfy', group: g.name, message: 'Aviso de prueba: ' + e.message, detail: { servidor: myServer } });
      toast('Error: ' + e.message, 'err', { action: { label: 'Detalles', fn: openDiagModal } });
    }
  };
  $('#btn-notify-guide').onclick = () => openNotifyGuideModal({ ntfyServer: myServer, ntfyTopic: me.ntfyTopic });
}
