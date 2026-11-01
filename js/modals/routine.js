/* Modal de rutina: nombre, icono y sus tareas (del catálogo o escritas). */
import * as db from '../db.js';
import { icon, TASK_ICONS } from '../icons.js';
import { guessIcon, normalizeTitle } from '../catalog.js';
import { G } from '../state.js';
import { $, $$, esc, toast, openModal, closeModal, confirmDialog } from '../ui.js';
import { scheduleAutoSync } from '../sync-ui.js';
import { refresh } from '../nav.js';

export async function openRoutineModal(routine = null) {
  const gid = G().id;
  const [cats, its] = await Promise.all([db.categories(gid), db.items(gid)]);
  const cur = routine ? { ...routine, items: routine.items.map((i) => ({ ...i })) } : { name: '', icon: 'sparkles', items: [] };
  const has = (title) => cur.items.some((i) => normalizeTitle(i.title) === normalizeTitle(title));

  openModal(routine ? 'Rutina' : 'Nueva rutina', `
    <div class="field"><label>Nombre</label>
      <input class="input" id="rt-name" value="${esc(cur.name)}" placeholder="Ej: Limpieza del sábado" maxlength="40">
    </div>
    <div class="field"><label>Tareas de la rutina</label>
      <div class="rt-items" id="rt-items"></div>
      <div class="pause-form" style="margin-top:8px">
        <input class="input" id="rt-new" placeholder="Escribe otra tarea" maxlength="80">
        <button type="button" class="btn btn--sm" id="rt-add">${icon('plus')}Añadir</button>
      </div>
    </div>
    <div class="field"><label>Añadir de tus tareas</label>
      <div class="chip-row" id="rt-cats">
        ${cats.map((c, i) => `<button type="button" class="chip-btn ${i === 0 ? 'is-active' : ''}" data-rcat="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
      </div>
      <div class="picks" id="rt-picks"></div>
    </div>
    <div class="field"><label>Icono</label>
      <div class="icon-grid" id="rt-icon">
        ${TASK_ICONS.map((k) => `<button type="button" class="${k === cur.icon ? 'is-active' : ''}" data-icon-pick="${k}" aria-label="${k}">${icon(k)}</button>`).join('')}
      </div>
    </div>
    <div class="modal__actions">
      ${routine ? `<button class="btn btn--danger" id="rt-delete">${icon('trash')}Eliminar</button>` : ''}
      <button class="btn btn--primary" id="rt-save">Guardar</button>
    </div>`, {
    onMount(modal) {
      let pcat = cats[0] ? cats[0].id : '';
      const renderItems = () => {
        $('#rt-items', modal).innerHTML = cur.items.length
          ? cur.items.map((it, i) => `<button type="button" class="pick is-active" data-rm="${i}" aria-label="Quitar ${esc(it.title)}">${icon(it.icon)}<span>${esc(it.title)}</span>${icon('x', { cls: 'parse-chip__x' })}</button>`).join('')
          : '<p class="help" style="margin:0">Aún no tiene tareas: elígelas abajo o escribe una.</p>';
        $$('[data-rm]', modal).forEach((b) => b.onclick = () => { cur.items.splice(Number(b.dataset.rm), 1); renderItems(); renderPicks(); });
      };
      const renderPicks = () => {
        const list = its.filter((i) => i.categoryId === pcat);
        $('#rt-picks', modal).innerHTML = list.map((i) => `<button type="button" class="pick ${has(i.name) ? 'is-active' : ''}" data-rpick="${esc(i.name)}" data-rpick-icon="${esc(i.icon)}">${icon(i.icon)}<span>${esc(i.name)}</span></button>`).join('')
          || '<p class="help" style="margin:0">No hay tareas en esta categoría.</p>';
        $$('[data-rpick]', modal).forEach((b) => b.onclick = () => {
          const title = b.dataset.rpick;
          if (has(title)) cur.items = cur.items.filter((i) => normalizeTitle(i.title) !== normalizeTitle(title));
          else cur.items.push({ title, icon: b.dataset.rpickIcon });
          renderItems(); renderPicks();
        });
      };
      $$('[data-rcat]', modal).forEach((b) => b.onclick = () => {
        pcat = b.dataset.rcat;
        $$('[data-rcat]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
        renderPicks();
      });
      const addTyped = () => {
        const input = $('#rt-new', modal);
        const title = input.value.trim();
        if (!title) return;
        if (!has(title)) cur.items.push({ title, icon: guessIcon(title, its) });
        input.value = '';
        renderItems(); renderPicks(); input.focus();
      };
      $('#rt-add', modal).onclick = addTyped;
      $('#rt-new', modal).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } };
      $$('[data-icon-pick]', modal).forEach((b) => b.onclick = () => {
        cur.icon = b.dataset.iconPick;
        $$('[data-icon-pick]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
      });
      renderItems(); renderPicks();

      $('#rt-save', modal).onclick = async () => {
        const name = $('#rt-name', modal).value.trim();
        if (!name) return toast('Escribe un nombre', 'err');
        if (!cur.items.length) return toast('Añade al menos una tarea', 'err');
        if (routine) await db.updateRoutine(routine.id, { name, icon: cur.icon, items: cur.items });
        else await db.addRoutine({ groupId: gid, name, icon: cur.icon, items: cur.items });
        closeModal(); toast('Rutina guardada', 'ok'); scheduleAutoSync(); await refresh();
      };
      const del = $('#rt-delete', modal);
      if (del) del.onclick = async () => {
        if (!await confirmDialog(`¿Eliminar la rutina «${routine.name}»? Las tareas no se borran.`, { danger: true, okText: 'Eliminar' })) return;
        await db.deleteRoutine(routine.id);
        toast('Rutina eliminada', 'ok'); scheduleAutoSync(); await refresh();
      };
    }
  });
}
