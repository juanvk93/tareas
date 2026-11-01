/* Pantalla de bienvenida / nuevo grupo: Compartido, Privado o Unirme. */
import * as db from '../db.js';
import { icon } from '../icons.js';
import { DEFAULT_GROUP, PERSONAL_GROUP, state, hasGroup } from '../state.js';
import { $, $$, view, esc, toast } from '../ui.js';
import { setView } from '../nav.js';
import { createGroup, joinGroup, parseInvite } from '../groups.js';

/* Pantalla para crear un grupo (compartido o privado) o unirse a uno. Es la
 * bienvenida cuando aún no hay grupos y la vista "nuevo" cuando ya los hay. */
export function renderOnboarding() {
  const s = state.settings;
  const first = !hasGroup();
  const mode = state.pendingInvite ? 'join' : (state.onboardMode || 'shared'); // shared | personal | join
  const hasPersonal = s.groups.some((g) => g.personal);
  const defaultName = mode === 'personal' ? (hasPersonal ? '' : PERSONAL_GROUP)
    : (s.groups.some((g) => g.name === DEFAULT_GROUP) ? '' : DEFAULT_GROUP);
  const hints = {
    shared: 'Para compartir las tareas con tu pareja o familia: todos veis las mismas y cualquiera puede resolverlas.',
    personal: 'Tus propias tareas pendientes: solo las ves tú.',
    join: 'Con la invitación que te ha enviado quien creó el grupo.'
  };

  view().innerHTML = `
    <div class="onboard">
      ${first ? `
        <div class="onboard__logo">${icon('home')}</div>
        <h1>Tareas</h1>
        <p class="muted">Tareas pendientes de hoy y las que estén por venir, solo para ti o compartidas con tu pareja o familia.</p>`
      : `<div class="flex-between"><h2 class="list-head__title">Nuevo grupo</h2><button class="btn btn--ghost btn--sm" id="ob-cancel">Cancelar</button></div>`}

      <div class="segment segment--block" style="margin:22px 0 10px">
        <button data-mode="shared" class="${mode === 'shared' ? 'is-active' : ''}">${icon('users')}Compartido</button>
        <button data-mode="personal" class="${mode === 'personal' ? 'is-active' : ''}">${icon('lock')}Privado</button>
        <button data-mode="join" class="${mode === 'join' ? 'is-active' : ''}">${icon('link')}Unirme</button>
      </div>
      <p class="help onboard__hint">${hints[mode]}</p>

      <div class="card">
        ${mode !== 'join' ? `
          <div class="field"><label>Nombre del grupo</label>
            <input class="input" id="ob-group" value="${esc(defaultName)}" placeholder="${mode === 'personal' ? 'Ej: Mis tareas' : 'Ej: Tareas Hogar'}" maxlength="40">
          </div>
          <div class="field"><label>Tu nombre</label>
            <input class="input" id="ob-name" value="${esc(s.myName)}" placeholder="Ej: Juan" maxlength="30" autocomplete="given-name">
            ${mode === 'shared' ? '<p class="help">Así te verán los demás miembros del grupo.</p>' : ''}
          </div>
          ${mode === 'shared' ? `<div class="field">
            <label class="flex-between" style="cursor:pointer">
              <span>Recibir avisos en este móvil (ntfy)</span>
              <input type="checkbox" id="ob-notify" checked class="switch">
            </label>
            <p class="help">Te avisa cuando otra persona añade o resuelve una tarea (tus cambios no te avisan). Se puede cambiar después.</p>
          </div>` : ''}
          ${mode === 'shared' && !hasPersonal ? `
          <div class="field">
            <label class="flex-between" style="cursor:pointer">
              <span>Crear también mi grupo privado «${PERSONAL_GROUP}»</span>
              <input type="checkbox" id="ob-personal-too" checked class="switch">
            </label>
          </div>` : ''}
          <button class="btn btn--primary btn--block" id="ob-create">Crear grupo</button>
          <p class="help" style="margin-top:12px">${mode === 'shared'
            ? 'Después, en la pestaña <b>Grupo</b>, conectas Google Sheets, activas los avisos e invitas a tu pareja.'
            : 'Si quieres tenerlo en varios dispositivos tuyos, conecta una Google Sheet en la pestaña <b>Grupo</b>.'}</p>
        ` : `
          ${state.pendingInvite ? `<div class="invite-box">${icon('link')}<div>Invitación al grupo <b>${esc(state.pendingInvite.groupName || DEFAULT_GROUP)}</b></div></div>` : `
          <div class="field"><label>Invitación</label>
            <input class="input" id="ob-code" placeholder="Pega aquí el enlace o el código" autocapitalize="off" autocomplete="off" spellcheck="false">
            <p class="help">Pídesela a quien creó el grupo: Grupo → Invitar a alguien.</p>
          </div>`}
          <div class="field"><label>Tu nombre</label>
            <input class="input" id="ob-name" value="${esc(s.myName)}" placeholder="Ej: Ana" maxlength="30" autocomplete="given-name">
          </div>
          <button class="btn btn--primary btn--block" id="ob-join">Unirme</button>
        `}
      </div>
    </div>`;

  $$('[data-mode]').forEach((b) => b.onclick = () => {
    state.onboardMode = b.dataset.mode;
    if (b.dataset.mode !== 'join') state.pendingInvite = null;
    renderOnboarding();
  });
  const cancel = $('#ob-cancel');
  if (cancel) cancel.onclick = () => { state.pendingInvite = null; state.onboardMode = null; setView('hoy'); };

  const createBtn = $('#ob-create');
  if (createBtn) createBtn.onclick = async () => {
    const personal = mode === 'personal';
    const name = $('#ob-group').value.trim();
    const myName = $('#ob-name').value.trim();
    if (!name) return toast('Ponle un nombre al grupo', 'err');
    if (!myName) return toast('Escribe tu nombre', 'err');
    const alsoPersonal = !!($('#ob-personal-too') && $('#ob-personal-too').checked);
    const withNotify = !personal && !!$('#ob-notify')?.checked;
    await db.saveSettings({ myName });
    await createGroup({ name, personal, myName, notify: withNotify });
    if (alsoPersonal) await createGroup({ name: PERSONAL_GROUP, personal: true, myName, activate: false });
    state.settings = await db.getSettings();
    state.onboardMode = null;
    toast(alsoPersonal ? `Grupos «${name}» y «${PERSONAL_GROUP}» creados` : `Grupo «${name}» creado`, 'ok');
    await setView(personal ? 'hoy' : 'grupo');
  };

  const joinBtn = $('#ob-join');
  if (joinBtn) joinBtn.onclick = async () => {
    const myName = $('#ob-name').value.trim();
    let invite = state.pendingInvite;
    if (!invite) {
      invite = parseInvite($('#ob-code').value.trim());
      if (!invite) return toast('La invitación no es válida', 'err');
    }
    if (!myName) return toast('Escribe tu nombre', 'err');
    await joinGroup(invite, myName);
  };
}
