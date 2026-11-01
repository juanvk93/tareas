/* Router: cambia de pestaña y repinta la vista actual. Las vistas se registran desde app.js
 * (registerViews) para no importar las vistas aquí y evitar dependencias circulares. */
import { state, hasGroup } from './state.js';
import { $, $$, view, applyShell } from './ui.js';

/** vista → función que la pinta ('nuevo' = bienvenida / nuevo grupo). */
const renderers = {};
export function registerViews(map) { Object.assign(renderers, map); }

export async function refreshKeepingScroll() {
  if ($('.modal-overlay')) return; // No repintar debajo de un formulario abierto.
  const a = document.activeElement;
  if (a && a.matches('input, textarea, select') && view().contains(a)) return; // Ni mientras se escribe.
  const y = window.scrollY;
  await refresh();
  window.scrollTo(0, y);
}

export async function setView(v) {
  state.view = v;
  $$('.tabbar__item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === v));
  await refresh();
  window.scrollTo(0, 0);
}

export async function refresh() {
  applyShell();
  if (!hasGroup() || state.view === 'nuevo') return renderers.nuevo();
  return renderers[state.view]?.();
}
