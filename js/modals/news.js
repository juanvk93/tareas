/* Novedades: modal del changelog y aviso tras actualizar. */
import * as db from '../db.js';
import { APP_VERSION, CHANGELOG, compareVersions } from '../changelog.js';
import { icon } from '../icons.js';
import { state, hasGroup } from '../state.js';
import { $, esc, openModal } from '../ui.js';

/* ------------------------------- Changelog ------------------------------ */
/**
 * Registro de cambios. Con `since` (tras una actualización) destaca las
 * versiones posteriores a esa y pliega el resto del historial.
 */
export function openChangelogModal({ since = '' } = {}) {
  const typeLabel = { add: ['add', 'Nuevo'], chg: ['chg', 'Mejora'], fix: ['fix', 'Arreglo'] };
  const isNew = (e) => since && compareVersions(e.version, since) > 0;
  const entry = (e) => `
    <div class="changelog-entry ${isNew(e) ? 'changelog-entry--new' : ''}">
      <div class="changelog-entry__head">
        <span class="changelog-entry__ver">v${esc(e.version)}</span>
        <span class="changelog-entry__date">${esc(e.date)}</span>
        ${e.version === APP_VERSION ? '<span class="changelog-new-tag">Actual</span>' : ''}
      </div>
      <ul>${e.changes.map((c) => {
        const [cls, lbl] = typeLabel[c.type] || ['chg', 'Cambio'];
        return `<li><span class="tag-type tag-type--${cls}">${lbl}</span> ${esc(c.text)}</li>`;
      }).join('')}</ul>
    </div>`;
  const fresh = CHANGELOG.filter(isNew);
  const html = fresh.length
    ? `<p class="changelog-intro">La app se ha actualizado a la versión ${esc(APP_VERSION)}. Esto es lo nuevo:</p>
       ${fresh.map(entry).join('')}
       <button class="btn btn--ghost btn--block btn--sm changelog-older" id="cl-older">${icon('history')}Ver todo el historial</button>
       <div id="cl-rest" class="hidden">${CHANGELOG.filter((e) => !isNew(e)).map(entry).join('')}</div>
       <div class="modal__actions"><button class="btn btn--primary btn--block" data-close>Entendido</button></div>`
    : CHANGELOG.map(entry).join('');
  openModal(fresh.length ? 'Novedades' : 'Registro de cambios', html, {
    onMount(modal) {
      const older = $('#cl-older', modal);
      if (older) older.onclick = () => { older.remove(); $('#cl-rest', modal).classList.remove('hidden'); };
    }
  });
}

/* Tras actualizar, enseña una vez las novedades. En una instalación nueva
 * solo se apunta la versión (no hay "novedades" para quien acaba de llegar). */
export async function showWhatsNewIfUpdated() {
  const seen = state.settings.lastSeenVersion;
  if (seen === APP_VERSION) return;
  state.settings = await db.saveSettings({ lastSeenVersion: APP_VERSION });
  if (!seen || !hasGroup() || compareVersions(APP_VERSION, seen) <= 0) return;
  openChangelogModal({ since: seen });
}
