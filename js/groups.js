/* Grupos: crear, unirse (invitaciones), cambiar de grupo y salir. */
import * as db from './db.js';
import { syncNow } from './sync.js';
import { icon } from './icons.js';
import { randomTopic, isValidTopic } from './notify.js';
import { todayKey } from './dates.js';
import { MEMBER_COLORS, DEFAULT_GROUP, state, G, hasGroup } from './state.js';
import { $$, esc, toast, openModal, closeModal, confirmDialog } from './ui.js';
import { doSync } from './sync-ui.js';
import { setView } from './nav.js';

export function nextColor(used) {
  return MEMBER_COLORS.find((c) => !used.includes(c)) || MEMBER_COLORS[used.length % MEMBER_COLORS.length];
}

/** Tema de ntfy propio de una persona en un grupo (difícil de adivinar). */
export const memberTopic = (groupName, myName) => randomTopic(`${groupName} ${myName}`);

export async function createGroup({ name, personal, myName, notify = !personal, activate = true }) {
  const group = await db.addGroup({ name, personal }, { activate });
  // El tema se genera siempre: así activar los avisos más tarde es un solo toque.
  const me = await db.addMember({ groupId: group.id, name: myName, color: MEMBER_COLORS[0], notify, ntfyTopic: memberTopic(name, myName) });
  await db.seedCatalog(group.id);
  state.settings = await db.updateGroup(group.id, { currentMemberId: me.id });
  return group;
}

/** Grupo de este móvil que corresponde a una invitación (misma hoja). */
export function findGroupForInvite(invite) {
  return (invite.syncUrl && state.settings.groups.find((g) => g.syncUrl === invite.syncUrl)) || null;
}

export async function joinGroup(invite, myName) {
  const existing = findGroupForInvite(invite);
  if (existing) {
    state.pendingInvite = null;
    await switchGroup(existing.id);
    return toast(`Ya estás en «${existing.name}»`);
  }
  await db.saveSettings({ myName });
  let group = await db.addGroup({
    name: invite.groupName || DEFAULT_GROUP, personal: false,
    syncUrl: invite.syncUrl || '', syncSecret: invite.syncSecret || '', autoSync: true,
    ntfyServer: invite.ntfyServer || 'https://ntfy.sh'
  });
  // Primero traemos el grupo (miembros y catálogo) para elegir un color libre
  // y no duplicar nombre. Sin hoja no hay nada que traer: catálogo inicial.
  if (group.syncUrl) { try { await syncNow(group); } catch (e) { console.warn(e); } }
  else await db.seedCatalog(group.id);
  const existingMembers = await db.members(group.id);
  const same = existingMembers.find((m) => m.name.trim().toLowerCase() === myName.toLowerCase());
  // Quien se une recibe avisos desde el principio (con su propio tema).
  const me = same || await db.addMember({ groupId: group.id, name: myName, color: nextColor(existingMembers.map((m) => m.color)), notify: true, ntfyTopic: memberTopic(group.name, myName) });
  if (same && !isValidTopic(same.ntfyTopic)) await db.updateMember(same.id, { notify: true, ntfyTopic: memberTopic(group.name, myName) });
  state.settings = await db.updateGroup(group.id, { currentMemberId: me.id });
  group = G();
  state.pendingInvite = null;
  state.onboardMode = null;
  toast(`Te has unido a «${group.name}»`, 'ok');
  await setView('hoy');
  if (group.syncUrl) doSync(true, group.id);
  else toast('La invitación no trae Google Sheets: no se compartirán las tareas', 'err');
}

export async function switchGroup(id) {
  state.settings = await db.saveSettings({ activeGroupId: id });
  state.search = '';
  state.showDoneToday = false;
  closeModal();
  await setView(state.view === 'nuevo' ? 'hoy' : state.view);
  doSync(true, id);
}

export function openNewGroup(mode) {
  closeModal();
  state.pendingInvite = null;
  state.onboardMode = mode;
  setView('nuevo');
}

/* Selector de grupo (se abre al tocar el nombre en la cabecera). */
export async function openGroupSwitcher() {
  if (!hasGroup()) return;
  const today = todayKey();
  const current = G().id;
  const rows = await Promise.all(state.settings.groups.map(async (g) => {
    const n = (await db.todos(g.id)).filter((t) => !t.done && !t.paused && t.dueDate <= today).length;
    const me = g.currentMemberId && await db.getOne('members', g.currentMemberId);
    return { g, n, notifyOn: !!(me && me.notify && isValidTopic(me.ntfyTopic)) };
  }));
  openModal('Tus grupos', `
    <div class="card card--pad0">
      ${rows.map(({ g, n, notifyOn }) => `
        <button class="group-row ${g.id === current ? 'is-active' : ''}" data-switch="${esc(g.id)}">
          <span class="group-row__icon">${icon(g.personal ? 'lock' : 'users')}</span>
          <span class="list-item__body">
            <span class="list-item__title">${esc(g.name)}</span>
            <span class="list-item__sub">${g.personal ? 'Privado' : 'Compartido'}${g.syncUrl ? '' : ' · solo en este móvil'}${notifyOn || g.personal ? '' : ' · sin avisos'}</span>
          </span>
          ${n ? `<span class="badge" title="Pendientes hoy">${n}</span>` : ''}
          ${g.id === current ? icon('check', { cls: 'group-row__check' }) : ''}
        </button>`).join('')}
    </div>
    <div class="group-actions">
      <button class="btn btn--block" data-new="shared">${icon('users')}Nuevo grupo compartido</button>
      <button class="btn btn--block" data-new="personal">${icon('lock')}Nuevo grupo privado</button>
      <button class="btn btn--ghost btn--block" data-new="join">${icon('link')}Unirme con una invitación</button>
    </div>`, {
    onMount(modal) {
      $$('[data-switch]', modal).forEach((b) => b.onclick = () => (b.dataset.switch === current ? closeModal() : switchGroup(b.dataset.switch)));
      $$('[data-new]', modal).forEach((b) => b.onclick = () => openNewGroup(b.dataset.new));
    }
  });
}

/* ----------------------------- Invitaciones ----------------------------- */
/* La invitación viaja en el hash de la URL (#join=...), que el navegador
 * nunca envía al servidor. Contiene el nombre del grupo, la URL de sync, la
 * clave y el tema de ntfy: compártela solo por un canal privado. */
export function encodeInvite(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function parseInvite(raw) {
  if (!raw) return null;
  try {
    const m = raw.match(/#join=([-_A-Za-z0-9]+)/);
    const b64 = (m ? m[1] : raw).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const cfg = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    if (!cfg || cfg.v !== 2) return null;
    return cfg;
  } catch { return null; }
}

export function inviteUrl() {
  const g = G();
  const code = encodeInvite({ v: 2, groupName: g.name, syncUrl: g.syncUrl, syncSecret: g.syncSecret, ntfyServer: g.ntfyServer });
  return `${location.origin}${location.pathname}#join=${code}`;
}

export async function shareInvite() {
  const g = G();
  if (!g.syncUrl && !await confirmDialog('Aún no has conectado Google Sheets: sin eso la otra persona no verá vuestras tareas. ¿Enviar la invitación igualmente?', { okText: 'Enviar' })) return;
  const url = inviteUrl();
  const text = `Únete a «${g.name}» en Tareas. Abre el enlace o pégalo en la app (Unirme):`;
  if (navigator.share) {
    try { await navigator.share({ title: g.name, text, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Invitación copiada: envíasela a tu pareja', 'ok'); }
  catch { prompt('Copia esta invitación y envíasela:', url); }
}

/* Si la app se abre con un enlace de invitación, se ofrece unirse (es un
 * grupo más: no hace falta salir de los que ya tengas). */
export async function checkInviteLink() {
  if (!location.hash.startsWith('#join=')) return;
  const invite = parseInvite(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  if (!invite) return toast('La invitación no es válida', 'err');
  const existing = findGroupForInvite(invite);
  if (existing) {
    await switchGroup(existing.id);
    return toast(`Ya estás en «${existing.name}»`);
  }
  state.pendingInvite = invite;
  state.onboardMode = 'join';
  await setView('nuevo');
}

export async function leaveGroup() {
  const g = G();
  const msg = g.personal
    ? `¿Eliminar el grupo privado «${g.name}»? Se borrarán sus tareas de este móvil${g.syncUrl ? ' (la copia en Google Sheets se mantiene)' : ''}.`
    : `¿Salir de «${g.name}»? Se borrarán de este móvil sus tareas. Los demás miembros las conservan.`;
  if (!await confirmDialog(msg, { danger: true, okText: g.personal ? 'Eliminar grupo' : 'Salir del grupo' })) return;
  // En un grupo compartido avisamos al resto de que ya no estamos.
  if (!g.personal && g.currentMemberId) {
    await db.deleteMember(g.currentMemberId);
    if (g.syncUrl) { try { await syncNow(g); } catch (e) { console.warn(e); } }
  }
  state.settings = await db.removeGroup(g.id);
  toast(g.personal ? `Grupo «${g.name}» eliminado` : `Has salido de «${g.name}»`, 'ok');
  await setView('hoy');
}
