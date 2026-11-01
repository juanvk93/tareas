/* Modal de crear / editar tarea. */
import * as db from '../db.js';
import { icon, TASK_ICONS } from '../icons.js';
import { todayKey, addDays, normalizeRepeat, parseRepeat, repeatLabel, alignDue, isoDay, REPEAT_PRESETS, REPEAT_UNITS, WEEKDAYS, WEEKDAY_LETTERS, isRepeating, isPaused, countsFromDone } from '../dates.js';
import { guessIcon, normalizeTitle } from '../catalog.js';
import { state, G, dueOf } from '../state.js';
import { $, $$, esc, dueLabel, toast, openModal, closeModal, confirmDialog, avatar } from '../ui.js';
import { scheduleAutoSync } from '../sync-ui.js';
import { refresh } from '../nav.js';
import { notifyCreated, notifyAssigned, pauseTask, resumeTask, postponeTask } from '../actions.js';
import { loadCatalog, parseChips, parseWith } from '../views/parts.js';

const FROM_DONE_ON = 'Si se hace tarde, la siguiente también se retrasa.';
const FROM_DONE_OFF = 'Sigue el calendario aunque se haga tarde.';

export async function openTodoModal({ todo = null, dueDate = todayKey(), when = '', title = '', icon: iconName = '' } = {}) {
  const gid = G().id;
  const [members, all] = await Promise.all([db.members(gid), db.todos(gid)]);
  const { cats, its, recent, itemByTitle } = await loadCatalog(all);
  const today = todayKey(), tomorrow = addDays(today, 1);
  const cur = todo ? { ...todo } : { title, icon: iconName || (title ? guessIcon(title, its) : 'sparkles'), dueDate, repeat: 'none', assignee: null, note: '' };
  let iconTouched = !!todo || !!iconName;
  // Repetición: una opción rápida del selector, «Días de la semana» (lunes y jueves…)
  // o «Personalizado» (cada N días/semanas/meses/años).
  const curRepeat = normalizeRepeat(cur.repeat);
  const parsed = parseRepeat(curRepeat);
  const repeatSel = parsed && parsed.days ? 'days' : REPEAT_PRESETS.includes(curRepeat) ? curRepeat : 'custom';
  const customRepeat = parsed && !parsed.days ? parsed : { n: 4, unit: 'w' };
  const weekly = parsed && parsed.days ? parsed : { n: 1, days: [isoDay(cur.dueDate)] };
  // Posponer (tareas pendientes): desde su fecha vigente o, si va atrasada, desde hoy.
  const canPostpone = todo && !todo.done && !todo.paused;
  const postponeBase = canPostpone && dueOf(todo) > today ? dueOf(todo) : today;
  const whenMode = when || (cur.dueDate === today ? 'today' : cur.dueDate === tomorrow ? 'tomorrow' : 'date');
  const catName = (id) => (cats.find((c) => c.id === id) || {}).name || 'Sin categoría';
  // Opciones del selector "Elegir de tus tareas": catálogo + recientes.
  // En «Todas» van primero las recientes y luego el catálogo en el orden de sus categorías.
  const catPos = new Map(cats.map((c, i) => [c.id, i]));
  const sortedItems = [...its].sort((a, b) => (catPos.get(a.categoryId) ?? 99) - (catPos.get(b.categoryId) ?? 99) || (a.order || 0) - (b.order || 0));
  const picks = [...recent.map((r) => ({ name: r.name, icon: r.icon, cat: '__recent' })), ...sortedItems.map((i) => ({ name: i.name, icon: i.icon, cat: i.categoryId }))];

  openModal(todo ? 'Editar tarea' : 'Nueva tarea', `
    <div class="field"><label>¿Qué hay que hacer?</label>
      <input class="input" id="td-title" placeholder="Escribe o elige abajo" maxlength="80" value="${esc(cur.title)}">
      ${todo ? '' : `<div class="parse-apply hidden" id="td-parse">
        <span class="parse-chips" id="td-parse-chips"></span>
        <button type="button" class="btn btn--sm" id="td-parse-apply">Aplicar</button>
      </div>`}
    </div>
    ${canPostpone ? `
    <div class="field"><label>Posponer</label>
      <div class="postpone-row">
        <button type="button" class="btn btn--sm" data-postpone="1">${postponeBase === today ? 'Mañana' : '+1 día'}</button>
        <button type="button" class="btn btn--sm" data-postpone="7">+1 semana</button>
        <button type="button" class="btn btn--sm" id="td-postpone-other">Otro día</button>
      </div>
      <div class="pause-form hidden" id="td-postpone-pick">
        <input class="input" type="date" id="td-postpone-date" min="${tomorrow}" value="${addDays(postponeBase, 2)}">
        <button type="button" class="btn btn--sm" id="td-postpone-go">Posponer</button>
      </div>
      ${isRepeating(todo.repeat) && !countsFromDone(todo) ? '<p class="help">Solo esta vez: las siguientes siguen su calendario.</p>' : ''}
    </div>` : ''}
    ${todo ? '' : `
    <div class="field"><label>Elegir de tus tareas</label>
      <div class="chip-row" id="td-pcats">
        <button type="button" class="chip-btn is-active" data-pcat="">Todas</button>
        ${recent.length ? '<button type="button" class="chip-btn" data-pcat="__recent">Recientes</button>' : ''}
        ${cats.map((c) => `<button type="button" class="chip-btn" data-pcat="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
      </div>
      <div class="picks" id="td-picks"></div>
    </div>`}
    <div class="field"><label>¿Cuándo?</label>
      <div class="segment segment--block" id="td-when">
        <button type="button" data-when="today" class="${whenMode === 'today' ? 'is-active' : ''}">Hoy</button>
        <button type="button" data-when="tomorrow" class="${whenMode === 'tomorrow' ? 'is-active' : ''}">Mañana</button>
        <button type="button" data-when="date" class="${whenMode === 'date' ? 'is-active' : ''}">Otro día</button>
      </div>
      <input class="input ${whenMode === 'date' ? '' : 'hidden'}" type="date" id="td-date" value="${esc(cur.dueDate)}" min="${today}" style="margin-top:8px">
    </div>
    <div class="field"><label>Repetir</label>
      <select class="select" id="td-repeat">
        ${REPEAT_PRESETS.map((k) => `<option value="${k}" ${k === repeatSel ? 'selected' : ''}>${repeatLabel(k)}</option>`).join('')}
        <option value="days" ${repeatSel === 'days' ? 'selected' : ''}>Días de la semana…</option>
        <option value="custom" ${repeatSel === 'custom' ? 'selected' : ''}>Personalizado…</option>
      </select>
      <div class="repeat-days ${repeatSel === 'days' ? '' : 'hidden'}" id="td-repeat-days">
        <div class="weekday-picker">
          ${WEEKDAY_LETTERS.map((l, i) => `<button type="button" class="weekday ${weekly.days.includes(i + 1) ? 'is-active' : ''}" data-wd="${i + 1}" aria-label="${WEEKDAYS[i]}" aria-pressed="${weekly.days.includes(i + 1)}">${l}</button>`).join('')}
        </div>
        <div class="repeat-custom">
          <span>Cada</span>
          <input class="input" type="number" id="td-days-n" min="1" max="52" inputmode="numeric" value="${weekly.n}">
          <span id="td-days-unit">${weekly.n === 1 ? 'semana' : 'semanas'}</span>
        </div>
        <p class="help" id="td-repeat-hint"></p>
      </div>
      <label class="flex-between from-done ${repeatSel === 'none' || repeatSel === 'days' ? 'hidden' : ''}" id="td-from-done-row">
        <span>Contar desde el día en que se haga
          <span class="help" id="td-from-done-help">${cur.repeatFrom === 'done' ? FROM_DONE_ON : FROM_DONE_OFF}</span></span>
        <input type="checkbox" id="td-from-done" class="switch" ${cur.repeatFrom === 'done' ? 'checked' : ''}>
      </label>
      <div class="repeat-custom ${repeatSel === 'custom' ? '' : 'hidden'}" id="td-repeat-custom">
        <span>Cada</span>
        <input class="input" type="number" id="td-repeat-n" min="1" max="365" inputmode="numeric" value="${customRepeat.n}">
        <select class="select" id="td-repeat-unit">
          ${Object.entries(REPEAT_UNITS).map(([k, l]) => `<option value="${k}" ${k === customRepeat.unit ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field ${G().personal ? 'hidden' : ''}"><label>¿A quién le toca?</label>
      <div class="person-picker" id="td-who">
        <button type="button" class="person-pick ${!cur.assignee ? 'is-active' : ''}" data-mid="">${icon('users')}Cualquiera</button>
        ${members.map((m) => `<button type="button" class="person-pick ${m.id === cur.assignee ? 'is-active' : ''}" data-mid="${esc(m.id)}">${avatar(m)}${esc(m.name)}</button>`).join('')}
      </div>
    </div>
    <div class="field"><label>Icono</label>
      <div class="icon-grid" id="td-icon">
        ${TASK_ICONS.map((k) => `<button type="button" class="${k === cur.icon ? 'is-active' : ''}" data-icon-pick="${k}" aria-label="${k}">${icon(k)}</button>`).join('')}
      </div>
    </div>
    <div class="field"><label>Nota (opcional)</label>
      <input class="input" id="td-note" placeholder="Ej: la de reciclaje también" maxlength="120" value="${esc(cur.note)}">
    </div>
    <div class="field"><label>Guardar como tarea habitual</label>
      <select class="select" id="td-cat">
        <option value="">No guardar</option>
        ${cats.map((c) => `<option value="${esc(c.id)}">En «${esc(c.name)}»</option>`).join('')}
        <option value="__new">En una categoría nueva…</option>
      </select>
      <input class="input hidden" id="td-newcat" placeholder="Nombre de la nueva categoría" maxlength="30" style="margin-top:8px">
      <p class="help hidden" id="td-cat-info"></p>
    </div>
    ${todo && !todo.done && isRepeating(todo.repeat) ? `
    <div class="field"><label>Pausa</label>
      ${isPaused(todo, today) ? `
      <div class="pause-state">${icon('pause')}<span>${todo.paused ? 'En pausa hasta que la reanudes'
        : `En pausa hasta ${esc(dueLabel(todo.pausedUntil).toLowerCase())} · vuelve ${esc(dueLabel(todo.dueDate).toLowerCase())}`}</span>
        <button type="button" class="btn btn--sm" id="td-resume">${icon('play')}Reanudar ya</button></div>` : `
      <div class="pause-form">
        <input class="input" type="date" id="td-pause-until" min="${tomorrow}" value="${addDays(today, 7)}">
        <button type="button" class="btn btn--sm" id="td-pause-date">${icon('pause')}Pausar hasta ese día</button>
      </div>
      <button type="button" class="btn btn--ghost btn--sm btn--block" id="td-pause-open">Pausar sin fecha</button>
      <p class="help">Mientras esté en pausa no sale en Hoy. Después vuelve el primer día que le toque.</p>`}
    </div>` : ''}
    <div class="modal__actions">
      ${todo ? `<button class="btn btn--danger" id="td-delete">${icon('trash')}Eliminar</button>` : ''}
      <button class="btn btn--primary" id="td-save">${todo ? 'Guardar' : 'Añadir'}</button>
    </div>`, {
    onMount(modal) {
      const titleInput = $('#td-title', modal);
      const dateInput = $('#td-date', modal);
      const catSelect = $('#td-cat', modal);
      const setIcon = (k) => {
        cur.icon = k;
        $$('[data-icon-pick]', modal).forEach((x) => x.classList.toggle('is-active', x.dataset.iconPick === k));
      };
      // "Guardar como tarea habitual": si ya está en el catálogo, solo se informa.
      const syncCatField = () => {
        const hit = itemByTitle.get(normalizeTitle(titleInput.value));
        catSelect.classList.toggle('hidden', !!hit);
        $('#td-newcat', modal).classList.toggle('hidden', !!hit || catSelect.value !== '__new');
        const info = $('#td-cat-info', modal);
        info.classList.toggle('hidden', !hit);
        if (hit) info.textContent = `Ya está en tu catálogo, en «${catName(hit.categoryId)}».`;
      };
      // Selector de tareas habituales (solo al crear).
      let pcat = '';
      const renderPicks = () => {
        const box = $('#td-picks', modal);
        if (!box) return;
        const q = normalizeTitle(titleInput.value);
        const list = picks.filter((p) => (!pcat || p.cat === pcat) && (!q || normalizeTitle(p.name).includes(q)));
        box.innerHTML = list.length
          ? list.map((p) => `<button type="button" class="pick ${normalizeTitle(p.name) === q ? 'is-active' : ''}" data-pick="${esc(p.name)}" data-pick-icon="${esc(p.icon)}">${icon(p.icon)}<span>${esc(p.name)}</span></button>`).join('')
          : '<p class="help" style="margin:4px 2px">Nada con ese nombre: se creará como tarea nueva.</p>';
        $$('[data-pick]', box).forEach((b) => b.onclick = () => {
          titleInput.value = b.dataset.pick;
          setIcon(b.dataset.pickIcon); iconTouched = true;
          renderPicks(); syncCatField();
        });
      };
      $$('[data-pcat]', modal).forEach((b) => b.onclick = () => {
        pcat = b.dataset.pcat;
        $$('[data-pcat]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
        renderPicks();
      });
      renderPicks(); syncCatField();

      // Escribir con naturalidad: «… el viernes cada 2 semanas» → chips + «Aplicar» rellena el formulario.
      let parsed = null;
      const parseBox = $('#td-parse', modal);
      const updateParse = () => {
        if (!parseBox) return;
        parsed = parseWith(titleInput.value, members);
        const chips = parsed.found.length ? parseChips(parsed) : '';
        parseBox.classList.toggle('hidden', !chips);
        $('#td-parse-chips', modal).innerHTML = chips;
      };
      const applyParsed = () => {
        const p = parsed;
        if (!p) return;
        titleInput.value = p.title;
        if (p.dueDate) {
          const w = p.dueDate === today ? 'today' : p.dueDate === tomorrow ? 'tomorrow' : 'date';
          $(`[data-when="${w}"]`, modal).click();
          dateInput.value = p.dueDate;
        }
        if (p.repeat) {
          const r = parseRepeat(p.repeat);
          if (r.days) {
            repeatSelect.value = 'days';
            $$('[data-wd]', modal).forEach((b) => { const on = r.days.includes(Number(b.dataset.wd)); b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
            daysN.value = r.n;
          } else if (REPEAT_PRESETS.includes(p.repeat)) repeatSelect.value = p.repeat;
          else { repeatSelect.value = 'custom'; $('#td-repeat-n', modal).value = r.n; $('#td-repeat-unit', modal).value = r.unit; }
          repeatSelect.onchange();
          fromDone.checked = p.repeatFrom === 'done';
          fromDone.onchange();
        }
        if (p.assignee) $(`[data-mid="${p.assignee}"]`, modal)?.click();
        updateDaysHint();
        updateParse();
        if (!iconTouched) setIcon(guessIcon(titleInput.value, its));
        renderPicks(); syncCatField();
      };
      if (parseBox) $('#td-parse-apply', modal).onclick = applyParsed;
      updateParse();
      titleInput.oninput = (e) => {
        updateParse();
        if (!iconTouched) setIcon(guessIcon(e.target.value, its));
        renderPicks(); syncCatField();
      };
      catSelect.onchange = () => {
        syncCatField();
        if (catSelect.value === '__new') $('#td-newcat', modal).focus();
      };
      $$('[data-when]', modal).forEach((b) => b.onclick = () => {
        $$('[data-when]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
        const w = b.dataset.when;
        dateInput.classList.toggle('hidden', w !== 'date');
        if (w === 'today') dateInput.value = today;
        else if (w === 'tomorrow') dateInput.value = tomorrow;
        else { if (dateInput.value < tomorrow) dateInput.value = tomorrow; dateInput.focus(); }
      });
      const repeatSelect = $('#td-repeat', modal);
      const daysN = $('#td-days-n', modal);
      const selectedDays = () => $$('[data-wd].is-active', modal).map((b) => b.dataset.wd);
      const readRepeat = () => {
        if (repeatSelect.value === 'custom') return normalizeRepeat(`${Math.min(365, parseInt($('#td-repeat-n', modal).value, 10) || 0)}${$('#td-repeat-unit', modal).value}`);
        if (repeatSelect.value === 'days') {
          const days = selectedDays();
          return days.length ? normalizeRepeat(`${Math.min(52, parseInt(daysN.value, 10) || 1)}w:${days.join(',')}`) : 'none';
        }
        return repeatSelect.value;
      };
      // Resumen bajo los días: qué se ha entendido y cuándo será la primera vez.
      const updateDaysHint = () => {
        const n = parseInt(daysN.value, 10) || 1;
        $('#td-days-unit', modal).textContent = n === 1 ? 'semana' : 'semanas';
        const r = readRepeat();
        const first = alignDue(dateInput.value || today, r);
        $('#td-repeat-hint', modal).textContent = r === 'none' ? 'Elige al menos un día.'
          : `${repeatLabel(r)} · primera vez: ${dueLabel(first).toLowerCase()}`;
      };
      const fromDone = $('#td-from-done', modal);
      fromDone.onchange = () => { $('#td-from-done-help', modal).textContent = fromDone.checked ? FROM_DONE_ON : FROM_DONE_OFF; };
      repeatSelect.onchange = () => {
        $('#td-from-done-row', modal).classList.toggle('hidden', repeatSelect.value === 'none' || repeatSelect.value === 'days');
        $('#td-repeat-custom', modal).classList.toggle('hidden', repeatSelect.value !== 'custom');
        $('#td-repeat-days', modal).classList.toggle('hidden', repeatSelect.value !== 'days');
        if (repeatSelect.value === 'custom') $('#td-repeat-n', modal).focus();
        if (repeatSelect.value === 'days') updateDaysHint();
      };
      $$('[data-wd]', modal).forEach((b) => b.onclick = () => {
        const on = !b.classList.contains('is-active');
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
        updateDaysHint();
      });
      daysN.oninput = updateDaysHint;
      dateInput.addEventListener('change', updateDaysHint);
      $$('[data-when]', modal).forEach((b) => b.addEventListener('click', updateDaysHint));
      updateDaysHint();
      $$('[data-mid]', modal).forEach((b) => b.onclick = () => {
        cur.assignee = b.dataset.mid || null;
        $$('[data-mid]', modal).forEach((x) => x.classList.toggle('is-active', x === b));
      });
      $$('[data-icon-pick]', modal).forEach((b) => b.onclick = () => { setIcon(b.dataset.iconPick); iconTouched = true; });

      $('#td-save', modal).onclick = async () => {
        const name = titleInput.value.trim();
        if (!name) return toast('Escribe o elige qué hay que hacer', 'err');
        const repeat = readRepeat();
        if (repeatSelect.value === 'custom' && repeat === 'none') return toast('Indica cada cuánto se repite (1 a 365)', 'err');
        if (repeatSelect.value === 'days' && repeat === 'none') return toast('Elige al menos un día de la semana', 'err');
        // Con días de la semana, la primera vez es el primer día marcado desde la fecha elegida.
        const due = alignDue(dateInput.value || today, repeat);
        // «Desde que se hace» solo con intervalos (con días de la semana manda el calendario).
        const repeatFrom = fromDone.checked && repeat !== 'none' && repeatSelect.value !== 'days' ? 'done' : null;
        const fields = { title: name, icon: cur.icon, dueDate: due, repeat, repeatFrom, assignee: cur.assignee, note: $('#td-note', modal).value.trim() };
        // Guardar en el catálogo (si se pidió y aún no está).
        if (!itemByTitle.has(normalizeTitle(name)) && catSelect.value) {
          let categoryId = catSelect.value;
          if (categoryId === '__new') {
            const cname = $('#td-newcat', modal).value.trim();
            if (!cname) return toast('Escribe el nombre de la categoría', 'err');
            categoryId = (await db.addCategory({ groupId: gid, name: cname })).id;
          }
          await db.addItem({ groupId: gid, name, icon: cur.icon, categoryId });
        }
        if (todo) {
          const updated = await db.updateTodo(todo.id, fields);
          if (fields.assignee && fields.assignee !== todo.assignee) notifyAssigned(updated);
          closeModal(); toast('Tarea guardada', 'ok');
        } else {
          const created = await db.addTodo({ ...fields, groupId: gid, createdBy: G().currentMemberId });
          notifyCreated(created);
          state.search = '';
          closeModal(); toast(due === today ? 'Añadida para hoy' : `Planificada: ${dueLabel(due)}`, 'ok');
        }
        scheduleAutoSync(); await refresh();
      };
      $$('[data-postpone]', modal).forEach((b) => b.onclick = () => {
        closeModal(); postponeTask(todo.id, addDays(postponeBase, Number(b.dataset.postpone)));
      });
      const otherBtn = $('#td-postpone-other', modal);
      if (otherBtn) otherBtn.onclick = () => { $('#td-postpone-pick', modal).classList.remove('hidden'); $('#td-postpone-date', modal).focus(); };
      const goBtn = $('#td-postpone-go', modal);
      if (goBtn) goBtn.onclick = () => {
        const d = $('#td-postpone-date', modal).value;
        if (!d || d <= today) return toast('Elige un día a partir de mañana', 'err');
        closeModal(); postponeTask(todo.id, d);
      };
      const pauseBtn = $('#td-pause-date', modal);
      if (pauseBtn) pauseBtn.onclick = () => {
        const until = $('#td-pause-until', modal).value;
        if (!until || until <= today) return toast('Elige un día a partir de mañana', 'err');
        closeModal(); pauseTask(todo.id, until);
      };
      const pauseOpen = $('#td-pause-open', modal);
      if (pauseOpen) pauseOpen.onclick = () => { closeModal(); pauseTask(todo.id, null); };
      const resumeBtn = $('#td-resume', modal);
      if (resumeBtn) resumeBtn.onclick = () => { closeModal(); resumeTask(todo.id); };
      const del = $('#td-delete', modal);
      if (del) del.onclick = async () => {
        if (!await confirmDialog(`¿Eliminar «${todo.title}»? Se borrará para todo el grupo.`, { danger: true, okText: 'Eliminar' })) return;
        await db.deleteTodo(todo.id);
        toast('Tarea eliminada', 'ok'); scheduleAutoSync(); await refresh();
      };
    }
  });
}
