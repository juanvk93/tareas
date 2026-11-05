/* Punto de entrada: arranque, registro de vistas y wiring de la cabecera y la barra inferior. */
import * as db from './db.js';
import { APP_VERSION } from './changelog.js';
import { icon } from './icons.js';
import { state, G } from './state.js';
import { $, $$, view, closeModal, applyAppearance, applyShell } from './ui.js';
import { doSync, startBackgroundSync, wantsSync, waitForSync } from './sync-ui.js';
import { setView, registerViews } from './nav.js';
import { openGroupSwitcher, checkInviteLink } from './groups.js';
import { openChangelogModal, showWhatsNewIfUpdated } from './modals/news.js';
import { renderOnboarding } from './views/onboarding.js';
import { renderHoy } from './views/hoy.js';
import { renderProximas } from './views/proximas.js';
import { renderHechas } from './views/hechas.js';
import { renderGrupo } from './views/grupo.js';
import { renderAjustes } from './views/ajustes.js';
import { installGlobalHandlers } from './diag.js';
import { registerServiceWorker } from './update.js';
import { installPullToRefresh } from './pull.js';

registerViews({
  nuevo: renderOnboarding,
  hoy: renderHoy,
  proximas: renderProximas,
  hechas: renderHechas,
  grupo: renderGrupo,
  ajustes: renderAjustes
});

async function init() {
  await db.openDB();
  installGlobalHandlers(); // Errores de JavaScript → Ajustes → Diagnóstico.
  state.settings = await db.getSettings();
  applyAppearance();

  // Solicitar almacenamiento persistente de forma silenciosa. Algunos navegadores
  // solo la conceden tras interactuar con la página: reintentamos en el primer toque.
  db.requestPersistentStorage().catch(() => {});
  document.addEventListener('pointerdown', () => db.requestPersistentStorage().catch(() => {}), { once: true });

  // Iconos estáticos del shell (cabecera y barra inferior).
  $$('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

  // Cabecera
  $('#header-version').textContent = 'v' + APP_VERSION;
  $('#header-version').onclick = () => openChangelogModal();
  $('#btn-sync').onclick = () => doSync(false);
  $('#group-switch').onclick = openGroupSwitcher;

  // Navegación
  $$('.tabbar__item').forEach((b) => b.onclick = () => setView(b.dataset.view));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('hashchange', checkInviteLink);
  installPullToRefresh();

  // Historial antiguo fuera (una vez al día) y sincronización de todos los grupos.
  db.purgeOld().catch((e) => console.warn('Limpieza:', e));
  startBackgroundSync();

  // Lo primero que se ve es lo de la hoja: se espera a que llegue (como mucho OPEN_WAIT_MS).
  // Sin conexión, sin hoja o si Google tarda, se pinta lo guardado y se repinta al llegar.
  if (wantsSync()) {
    renderOpening();
    window.__tareasBooted = true;
    await waitForSync(G().id);
  }
  // Si la sincronización ya repintó (llegó algo) o se cambió de pestaña, no se pisa.
  if (!window.__tareasBooted || $('#view .opening')) await setView('hoy');
  window.__tareasBooted = true; // Ver el arranque de seguridad de index.html.
  await checkInviteLink();
  // Acceso directo «Añadir tarea» del icono (manifest → ?accion=nueva): el buscador, listo para escribir.
  if (new URLSearchParams(location.search).get('accion') === 'nueva') {
    history.replaceState(null, '', location.pathname + location.hash); // Que recargar no lo repita.
    if (G() && !$('.modal-overlay')) { if (state.view !== 'hoy') await setView('hoy'); window.scrollTo(0, 0); $('#search-input')?.focus(); }
  } else if (!$('.modal-overlay')) await showWhatsNewIfUpdated();

  // Service Worker (+ aviso «Versión X disponible · Recargar»).
  await registerServiceWorker();
}

/** Pantalla de espera mientras llega la hoja al abrir la app. */
function renderOpening() {
  applyShell();
  view().innerHTML = `<div class="opening">${icon('refresh')}<p>Trayendo lo último de Google Sheets…</p></div>`;
}

init();
