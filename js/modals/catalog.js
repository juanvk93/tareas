/* Modales del catálogo: tarea habitual y categoría. */
import * as db from '../db.js';
import { icon, TASK_ICONS } from '../icons.js';
import { todayKey, addDays } from '../dates.js';
import { guessIcon } from '../catalog.js';
import { G } from '../state.js';
import { $, $$, esc, toast, openModal, closeModal, confirmDialog } from '../ui.js';
import { scheduleAutoSync } from '../sync-ui.js';
import { refresh } from '../nav.js';
import { openTodoModal } from './todo.js';

/* Editar una tarea del catálogo, o guardar en él una reciente/nueva. */
export async function openItemModal({ item = null, title = '', icon: iconName = '', categoryId = null } = {}) {
  const gid = G().id;
  const cats = await db.categories(gid);
  const cur = item ? { ...item } : { name: title, icon: iconName || (title ? guessIcon(title) : 'sparkles'), categoryId: categoryId || (cats[0] && cats[0].id) || null };
  let newCat = !cats.length;

  openModal(item ? 'Tarea habitual' : 'Guardar en el catálogo', `
    <div class="field"><label>Nombre</label>
      <input class="input" id="it-name" value="${esc(cur.name)}" placeholder="Ej: Limpiar el horno" maxlength="80">
    </div>
    <div class="field"><label>Categoría</label>
      <div class="person-picker" id="it-cats">
        ${cats.map((c) => `<button type="button" class="person-pick ${c.id === cur.categoryId && !newCat ? 'is-active' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
        <button type="button" class="person-pick ${newCat ? 'is-active' : ''}" data-cat="__new">${icon('plus')}Nueva</button>
      </div>
      <input class="input ${newCat ? '' : 'hidden'}" id="it-newcat" placeholder="Nombre de la nueva categoría" maxlength="30" style="margin-top:8px">
    </div>
    <div class="field"><label>Icono</label>
      <div class="icon-grid" id="it-icon">
        ${TASK_ICONS.map((k) => `<button type="button" class="${k === cur.icon ? 'is-active' : ''}" data-icon-pick="${k}" aria-label="${k}">${icon(k)}</button>`).join('')}
      </div>
    </div>
    <div class="modal__actions">
      ${item ? `<button class="btn btn--danger" id="it-delete">${icon('trash')}Quitar</button>` : ''}
      <button class="btn btn--primary" id="it-save">Guardar</button>
    </div>
    <button class="btn btn--ghost btn--block btn--sm" id="it-plan" style="margin-top:10px">${icon('calendar')}Planificar para otro día</button>`, {
    onMount(modal) {
      $$('[data-cat]', modal).forEach((b) => b.onclick = () => {
        newCat = b.dataset.cat === '__new';
        if (!newCat) cur.categoryId = b.dataset.cat;
        $$('[data-cat]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
        $('#it-newcat', modal).classList.toggle('hidden', !newCat);
        if (newCat) $('#it-newcat', modal).focus();
      });
      $$('[data-icon-pick]', modal).forEach((b) => b.onclick = () => {
        cur.icon = b.dataset.iconPick;
        $$('[data-icon-pick]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
      });
      $('#it-save', modal).onclick = async () => {
        const name = $('#it-name', modal).value.trim();
        if (!name) return toast('Escribe un nombre', 'err');
        let categoryId = cur.categoryId;
        if (newCat) {
          const cname = $('#it-newcat', modal).value.trim();
          if (!cname) return toast('Escribe el nombre de la categoría', 'err');
          categoryId = (await db.addCategory({ groupId: gid, name: cname })).id;
        }
        if (item) await db.updateItem(item.id, { name, icon: cur.icon, categoryId });
        else await db.addItem({ groupId: gid, name, icon: cur.icon, categoryId });
        closeModal(); toast(item ? 'Tarea habitual guardada' : 'Guardada en el catálogo', 'ok');
        scheduleAutoSync(); await refresh();
      };
      const del = $('#it-delete', modal);
      if (del) del.onclick = async () => {
        await db.deleteItem(item.id);
        closeModal(); toast(`«${item.name}» quitada del catálogo`, 'ok');
        scheduleAutoSync(); await refresh();
      };
      $('#it-plan', modal).onclick = () => openTodoModal({
        title: $('#it-name', modal).value.trim(), icon: cur.icon, dueDate: addDays(todayKey(), 1), when: 'date'
      });
    }
  });
}

export async function openCategoryModal(cat = null) {
  const gid = G().id;
  const cats = await db.categories(gid);
  const idx = cat ? cats.findIndex((c) => c.id === cat.id) : -1;
  const count = cat ? (await db.items(gid)).filter((i) => i.categoryId === cat.id).length : 0;

  openModal(cat ? 'Categoría' : 'Nueva categoría', `
    <div class="field"><label>Nombre</label>
      <input class="input" id="cat-name" value="${esc(cat ? cat.name : '')}" placeholder="Ej: Jardín" maxlength="30">
    </div>
    ${cat ? `
    <div class="field"><label>Posición</label>
      <div class="row">
        <button class="btn btn--sm" id="cat-up" ${idx <= 0 ? 'disabled' : ''}>${icon('chevron-up')}Subir</button>
        <button class="btn btn--sm" id="cat-down" ${idx >= cats.length - 1 ? 'disabled' : ''}>${icon('chevron-down')}Bajar</button>
      </div>
    </div>` : ''}
    <div class="modal__actions">
      ${cat ? `<button class="btn btn--danger" id="cat-delete">${icon('trash')}Eliminar</button>` : ''}
      <button class="btn btn--primary" id="cat-save">${cat ? 'Guardar' : 'Crear'}</button>
    </div>`, {
    onMount(modal) {
      const input = $('#cat-name', modal);
      if (!cat) input.focus();
      $('#cat-save', modal).onclick = async () => {
        const name = input.value.trim();
        if (!name) return toast('Escribe un nombre', 'err');
        if (cat) await db.updateCategory(cat.id, { name });
        else await db.addCategory({ groupId: gid, name, order: cats.length ? (cats[cats.length - 1].order || 0) + 1 : 0 });
        closeModal(); toast(cat ? 'Categoría guardada' : `Categoría «${name}» creada`, 'ok');
        scheduleAutoSync(); await refresh();
      };
      // Reordenar: se renumeran todas y se intercambia con la vecina.
      const move = async (delta) => {
        const list = [...cats];
        const [moved] = list.splice(idx, 1);
        list.splice(idx + delta, 0, moved);
        for (let i = 0; i < list.length; i++) if (list[i].order !== i) await db.updateCategory(list[i].id, { order: i });
        closeModal(); scheduleAutoSync(); await refresh();
      };
      const up = $('#cat-up', modal), down = $('#cat-down', modal);
      if (up) up.onclick = () => move(-1);
      if (down) down.onclick = () => move(1);
      const del = $('#cat-delete', modal);
      if (del) del.onclick = async () => {
        const msg = count
          ? `¿Eliminar «${cat.name}» y sus ${count} tarea${count === 1 ? '' : 's'} habitual${count === 1 ? '' : 'es'}? Las tareas pendientes no se tocan.`
          : `¿Eliminar la categoría «${cat.name}»?`;
        if (!await confirmDialog(msg, { danger: true, okText: 'Eliminar' })) return;
        await db.deleteCategory(cat.id);
        toast('Categoría eliminada', 'ok'); scheduleAutoSync(); await refresh();
      };
    }
  });
}
