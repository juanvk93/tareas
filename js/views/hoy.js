/* Vista Hoy (estilo Bring): buscador, pendientes, recientes y catálogo por categorías. */
import * as db from '../db.js';
import { icon } from '../icons.js';
import { ymd, todayKey, isRepeating, todoRepeatLabel } from '../dates.js';
import { searchItems, guessIcon, normalizeTitle } from '../catalog.js';
import { state, G, dueOf } from '../state.js';
import { $, $$, view, esc, fmtLongDate, dueLabel, toast, avatar, fab } from '../ui.js';
import { scheduleAutoSync } from '../sync-ui.js';
import { setView, refresh } from '../nav.js';
import { notifyCreated, completeTodo, runRoutine } from '../actions.js';
import { todoList, wireTodoRows, loadCatalog, tile, parseChips, parseWith } from './parts.js';
import { openTodoModal } from '../modals/todo.js';
import { openItemModal, openCategoryModal } from '../modals/catalog.js';
import { openRoutineModal } from '../modals/routine.js';

export async function renderHoy() {
  const [members, all, routines] = await Promise.all([db.members(G().id), db.todos(G().id), db.routines(G().id)]);
  const { cats, its, recent, itemByTitle } = await loadCatalog(all);
  const memById = new Map(members.map((m) => [m.id, m]));
  const today = todayKey();
  const pending = all.filter((t) => !t.done && !t.paused && t.dueDate <= today)
    .sort((a, b) => dueOf(a).localeCompare(dueOf(b)) || a.createdAt - b.createdAt);
  const doneToday = all.filter((t) => t.done && ymd(new Date(t.doneAt)) === today).sort((a, b) => b.doneAt - a.doneAt);
  const pendingByTitle = new Map(pending.map((t) => [normalizeTitle(t.title), t]));
  const upcomingCount = all.filter((t) => !t.done && !t.paused && t.dueDate > today).length;
  const recentFree = recent.filter((r) => !pendingByTitle.has(normalizeTitle(r.name)));

  const pendingTile = (t) => {
    const who = memById.get(t.assignee);
    const overdue = dueOf(t) < today;
    const badges = [
      overdue ? `<span class="tile__badge tile__badge--danger" title="Atrasada">${icon('alert')}</span>` : '',
      isRepeating(t.repeat) ? `<span class="tile__badge" title="${esc(todoRepeatLabel(t))}">${icon('repeat')}</span>` : '',
      who ? avatar(who, 'xs') : ''
    ].join('');
    return tile({ title: t.title, iconName: t.icon, active: true, overdue,
      extra: badges ? `<span class="tile__badges">${badges}</span>` : '',
      attrs: `data-tile-todo="${esc(t.id)}" aria-label="Resolver ${esc(t.title)}"` });
  };
  // Casilla de una tarea habitual o reciente: si ya está pendiente sale en color.
  const addTile = (name, iconName, itemId = '') => {
    const p = pendingByTitle.get(normalizeTitle(name));
    if (p) return pendingTile(p);
    return tile({ title: name, iconName, attrs: `data-tile-add="${esc(name)}" data-tile-icon="${esc(iconName)}" ${itemId ? `data-item-id="${esc(itemId)}"` : ''} aria-label="Añadir ${esc(name)}"` });
  };
  const newItemTile = (catId) => `<button class="tile tile--add" data-new-item="${esc(catId)}" aria-label="Nueva tarea habitual">
      <span class="tile__icon">${icon('plus')}</span><span class="tile__name">Nueva</span></button>`;

  let html = `
    <div class="list-head">
      <div>
        <div class="muted text-sm">${esc(fmtLongDate(new Date()))}</div>
        <h2 class="list-head__title">${pending.length ? `${pending.length} pendiente${pending.length === 1 ? '' : 's'}` : 'Todo al día'}</h2>
      </div>
      ${doneToday.length ? `<button class="btn btn--ghost btn--sm" id="toggle-done">${icon('check-circle')}${doneToday.length} hoy</button>` : ''}
    </div>
    <form class="search-add" id="search-add" autocomplete="off">
      ${icon('plus')}
      <input class="input" id="search-input" placeholder="¿Qué hay que hacer?" maxlength="80" enterkeyhint="done" value="${esc(state.search || '')}">
    </form>
    <div id="search-results"></div>
    <div id="main-tiles">`;

  if (pending.length) {
    html += `<div class="tiles tiles--pending">${pending.map(pendingTile).join('')}</div>
      <p class="help center tiles-hint">Toca para resolver · Mantén pulsado para editar</p>`;
  } else {
    html += `<div class="card empty"><span class="empty__emoji">${icon('sparkles')}</span>No hay nada pendiente para hoy.<div class="muted text-sm" style="margin-top:6px">Toca una tarea de abajo para añadirla.</div></div>`;
  }
  if (upcomingCount) html += `<button class="btn btn--ghost btn--block btn--sm" data-goto="proximas" style="margin-bottom:10px">${icon('calendar')}${upcomingCount} planificada${upcomingCount === 1 ? '' : 's'} para otros días</button>`;

  if (state.showDoneToday && doneToday.length) {
    html += `<div class="section-title"><h2>Resueltas hoy</h2></div>` + todoList(doneToday, memById);
  }
  // Rutinas: un toque añade sus tareas; en color si ya están todas pendientes.
  html += `<div class="section-title"><h2>Rutinas</h2></div><div class="tiles">${routines.map((r) => {
    const missing = r.items.filter((i) => !pendingByTitle.has(normalizeTitle(i.title))).length;
    return tile({
      title: r.name, iconName: r.icon, active: !missing, cls: 'tile--routine',
      extra: `<span class="tile__badges"><span class="tile__badge tile__badge--count" title="${r.items.length} tareas">${r.items.length}</span></span>`,
      attrs: `data-routine="${esc(r.id)}" aria-label="${missing ? `Añadir ${esc(r.name)} (${missing} tareas)` : `${esc(r.name)}: ya están todas pendientes`}"`
    });
  }).join('')}<button class="tile tile--add" id="btn-new-routine" aria-label="Nueva rutina">
      <span class="tile__icon">${icon('plus')}</span><span class="tile__name">Nueva rutina</span></button></div>`;
  if (recentFree.length) {
    html += `<div class="section-title"><h2>Recientes</h2></div><div class="tiles">${recentFree.map((r) => addTile(r.name, r.icon)).join('')}</div>`;
  }
  const catIds = new Set(cats.map((c) => c.id));
  for (const cat of cats) {
    const list = its.filter((i) => i.categoryId === cat.id);
    html += `<div class="section-title"><h2>${esc(cat.name)}</h2>
        <button class="icon-btn icon-btn--sm" data-edit-cat="${esc(cat.id)}" aria-label="Editar categoría ${esc(cat.name)}">${icon('edit')}</button></div>
      <div class="tiles">${list.map((i) => addTile(i.name, i.icon, i.id)).join('')}${newItemTile(cat.id)}</div>`;
  }
  const orphans = its.filter((i) => !catIds.has(i.categoryId));
  if (orphans.length) {
    html += `<div class="section-title"><h2>Sin categoría</h2></div><div class="tiles">${orphans.map((i) => addTile(i.name, i.icon, i.id)).join('')}</div>`;
  }
  html += `<button class="btn btn--ghost btn--block" id="btn-new-cat" style="margin-bottom:12px">${icon('plus')}Nueva categoría</button>
    <p class="help center">Mantén pulsada una tarea del catálogo para editarla o cambiarla de categoría.</p>`;
  html += `</div>` + fab('Nueva tarea con fecha');
  view().innerHTML = html;

  wireTiles(all, routines);
  wireTodoRows(all);
  $('#btn-new-routine').onclick = () => openRoutineModal(null);
  $$('[data-goto]').forEach((b) => b.onclick = () => setView(b.dataset.goto));
  $$('[data-edit-cat]').forEach((b) => b.onclick = () => openCategoryModal(cats.find((c) => c.id === b.dataset.editCat)));
  $$('[data-new-item]').forEach((b) => b.onclick = () => openItemModal({ categoryId: b.dataset.newItem }));
  $('#btn-new-cat').onclick = () => openCategoryModal(null);
  $('#fab-add').onclick = () => openTodoModal({ dueDate: today, title: $('#search-input').value.trim() });
  const tg = $('#toggle-done');
  if (tg) tg.onclick = () => { state.showDoneToday = !state.showDoneToday; renderHoy(); };

  // Buscador: filtra el catálogo y permite crear una tarea con lo escrito.
  const input = $('#search-input');
  const renderResults = () => {
    const raw = input.value.trim();
    state.search = raw;
    $('#main-tiles').classList.toggle('hidden', !!raw);
    if (!raw) { state.parseIgnore.clear(); $('#search-results').innerHTML = ''; return; }
    // «Sacar el vidrio el viernes cada 2 semanas»: se busca y se crea con el título limpio.
    const p = parseWith(raw, members, state.parseIgnore);
    const q = p.title || raw;
    const when = p.dueDate && p.dueDate !== today ? `para ${dueLabel(p.dueDate).toLowerCase()}` : 'a hoy';
    const matches = searchItems(its, q).slice(0, 12);
    const recentMatches = searchItems(recentFree, q).slice(0, 6);
    const exact = itemByTitle.has(normalizeTitle(q)) || pendingByTitle.has(normalizeTitle(q))
      || recentFree.some((r) => normalizeTitle(r.name) === normalizeTitle(q));
    const guess = guessIcon(q, its);
    const chips = parseChips(p, { removable: true });
    $('#search-results').innerHTML = `${chips ? `<div class="parse-chips">${chips}</div>` : ''}<div class="tiles">
      ${exact ? '' : tile({ title: q, iconName: guess, cls: 'tile--new', attrs: `data-tile-add="${esc(q)}" data-tile-icon="${esc(guess)}" data-new-title="1"` })}
      ${recentMatches.map((r) => addTile(r.name, r.icon)).join('')}
      ${matches.map((m) => addTile(m.name, m.icon, m.id)).join('')}
    </div><p class="help center">${chips ? `Toca para añadirla ${esc(when)} · Toca un chip para descartarlo`
      : 'Toca para añadirla a hoy · Prueba «… mañana», «… los lunes» o «… cada 2 semanas»'}</p>`;
    $$('[data-ignore]').forEach((b) => b.onclick = () => { state.parseIgnore.add(b.dataset.ignore); renderResults(); input.focus(); });
    wireTiles(all);
  };
  input.oninput = renderResults;
  $('#search-add').onsubmit = async (e) => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;
    const q = parseWith(raw, members, state.parseIgnore).title || raw;
    if (pendingByTitle.has(normalizeTitle(q)) && !parseWith(raw, members, state.parseIgnore).found.length) { toast('Ya está pendiente'); return; }
    const hit = itemByTitle.get(normalizeTitle(q));
    await addForToday(hit ? hit.name : q, hit ? hit.icon : guessIcon(q, its), { isNew: !hit });
  };
  if (state.search) { renderResults(); input.focus(); }
}

export async function addForToday(title, iconName, { isNew = false } = {}) {
  // Desde el buscador se aplica lo entendido en el texto (fecha, repetición, a quién le toca).
  const p = state.search ? parseWith(state.search, await db.members(G().id), state.parseIgnore) : null;
  const today = todayKey();
  const todo = await db.addTodo({
    groupId: G().id, title, icon: iconName, createdBy: G().currentMemberId,
    dueDate: p?.dueDate || today, repeat: p?.repeat, repeatFrom: p?.repeatFrom, assignee: p?.assignee
  });
  state.search = '';
  state.parseIgnore.clear();
  scheduleAutoSync(); notifyCreated(todo);
  const extra = [todo.dueDate !== today ? dueLabel(todo.dueDate).toLowerCase() : '', isRepeating(todo.repeat) ? todoRepeatLabel(todo).toLowerCase() : ''].filter(Boolean).join(' · ');
  // Si es una tarea nueva, se ofrece guardarla en una categoría del catálogo.
  toast(`${todo.dueDate !== today ? 'Planificada' : 'Añadida'}: ${title}${extra ? ` (${extra})` : ''}`, 'ok', {
    action: isNew
      ? { label: 'Guardar en categoría', fn: () => openItemModal({ title, icon: iconName }) }
      : { label: 'Deshacer', fn: async () => { await db.deleteTodo(todo.id); scheduleAutoSync(); refresh(); } }
  });
  await renderHoy();
}

/* Toque = acción principal; pulsación larga (o clic derecho) = editar. */
export function wireTiles(all, routines = []) {
  const LONG_MS = 450;
  $$('[data-tile-todo], [data-tile-add], [data-routine]').forEach((el) => {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    let timer = null, longFired = false;
    const routine = routines.find((r) => r.id === el.dataset.routine);
    const edit = async () => {
      if (routine) return openRoutineModal(routine);
      const t = all.find((x) => x.id === el.dataset.tileTodo);
      if (t) return openTodoModal({ todo: t });
      const item = el.dataset.itemId && await db.getOne('items', el.dataset.itemId);
      openItemModal(item ? { item } : { title: el.dataset.tileAdd, icon: el.dataset.tileIcon });
    };
    el.addEventListener('pointerdown', () => {
      longFired = false;
      timer = setTimeout(() => { longFired = true; navigator.vibrate?.(15); edit(); }, LONG_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => el.addEventListener(ev, () => clearTimeout(timer)));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(timer); if (!longFired) edit(); longFired = true; });
    el.addEventListener('click', () => {
      if (longFired) { longFired = false; return; }
      if (routine) runRoutine(routine);
      else if (el.dataset.tileTodo) completeTodo(el.dataset.tileTodo);
      else addForToday(el.dataset.tileAdd, el.dataset.tileIcon, { isNew: !!el.dataset.newTitle });
    });
  });
}
