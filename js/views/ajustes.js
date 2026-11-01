/* Vista Ajustes: apariencia, almacenamiento, copia de seguridad, diagnóstico y novedades. */
import * as db from '../db.js';
import { APP_VERSION } from '../changelog.js';
import { icon } from '../icons.js';
import { ymd } from '../dates.js';
import { ACCENTS, state, G, hasGroup } from '../state.js';
import { $, $$, view, toast, applyAppearance } from '../ui.js';
import { scheduleAutoSync } from '../sync-ui.js';
import { refresh } from '../nav.js';
import { openChangelogModal } from '../modals/news.js';
import { openDiagModal } from '../modals/diag.js';
import { readLog } from '../diag.js';

export async function renderAjustes() {
  const s = state.settings;
  const persist = await navigator.storage?.persisted?.().catch(() => false);
  const est = await db.storageEstimate();
  const usage = est ? `${(est.usage / 1024).toFixed(0)} KB usados` : '';
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const recentErrors = (await readLog()).filter((e) => e.level === 'error' && e.at > dayAgo).length;

  view().innerHTML = `
    <!-- Apariencia -->
    <div class="section-title"><h2>Apariencia</h2></div>
    <div class="card">
      <div class="field"><label>Tema</label>
        <div class="segment segment--block" id="set-theme">
          <button data-theme-btn="dark" class="${s.theme === 'dark' ? 'is-active' : ''}">${icon('moon')}Oscuro</button>
          <button data-theme-btn="light" class="${s.theme === 'light' ? 'is-active' : ''}">${icon('sun')}Claro</button>
        </div>
      </div>
      <div class="field mb-0"><label>Color de acento</label>
        <div class="color-grid" id="set-accent">
          ${ACCENTS.map((c) => `<button type="button" class="color-swatch ${c === s.accent ? 'is-active' : ''}" style="background:${c}" data-accent="${c}" aria-label="Color ${c}"></button>`).join('')}
        </div>
      </div>
    </div>

    <!-- Almacenamiento -->
    <div class="section-title"><h2>Almacenamiento</h2></div>
    <div class="card">
      <div class="sync-status" style="margin-bottom:${persist ? '0' : '12px'}">
        <span class="sync-dot ${persist ? 'sync-dot--ok' : 'sync-dot--off'}"></span>
        <span>${persist ? 'Almacenamiento persistente activo' : 'Almacenamiento no persistente'} ${usage ? '· ' + usage : ''}</span>
      </div>
      ${persist ? '' : `<button class="btn btn--block btn--sm" id="btn-persist">Activar almacenamiento persistente</button>
        <p class="help">Instalar la app en la pantalla de inicio ayuda a que el navegador lo conceda.</p>`}
    </div>

    <!-- Datos -->
    <div class="section-title"><h2>Copia de seguridad</h2></div>
    <div class="card">
      <div class="row">
        <button class="btn btn--sm" id="btn-export">${icon('download')}Exportar</button>
        <button class="btn btn--sm" id="btn-import">${icon('upload')}Importar</button>
      </div>
      <input type="file" id="file-import" accept="application/json" class="hidden">
    </div>

    <!-- Diagnóstico -->
    <div class="section-title"><h2>Diagnóstico</h2></div>
    <div class="card flex-between">
      <div class="sync-status"><span class="sync-dot ${recentErrors ? 'sync-dot--err' : 'sync-dot--ok'}"></span>
        <span>${recentErrors ? `${recentErrors} ${recentErrors === 1 ? 'error' : 'errores'} en las últimas 24 h` : 'Sin errores en las últimas 24 h'}</span></div>
      <button class="btn btn--sm" id="btn-diag">Ver</button>
    </div>

    <!-- Acerca de -->
    <div class="section-title"><h2>Acerca de</h2></div>
    <div class="card flex-between">
      <div><div class="list-item__title">Tareas</div><div class="muted text-sm">Versión ${APP_VERSION}</div></div>
      <button class="btn btn--sm" id="btn-changelog">Novedades</button>
    </div>
    <p class="help center" style="margin-top:16px">Hecho con ${icon('heart', { cls: 'ico--heart' })} · Datos guardados en tu dispositivo (IndexedDB).</p>
  `;

  $$('[data-theme-btn]').forEach((b) => b.onclick = async () => {
    state.settings = await db.saveSettings({ theme: b.dataset.themeBtn });
    applyAppearance(); await renderAjustes();
  });
  $$('[data-accent]').forEach((b) => b.onclick = async () => {
    state.settings = await db.saveSettings({ accent: b.dataset.accent });
    applyAppearance(); await renderAjustes();
  });
  const persistBtn = $('#btn-persist');
  if (persistBtn) persistBtn.onclick = async () => {
    const r = await db.requestPersistentStorage();
    toast(r.persisted ? 'Persistencia activada' : 'El navegador no la concedió', r.persisted ? 'ok' : 'err');
    await renderAjustes();
  };
  $('#btn-export').onclick = exportData;
  $('#btn-import').onclick = () => $('#file-import').click();
  $('#file-import').onchange = importData;
  $('#btn-changelog').onclick = openChangelogModal;
  $('#btn-diag').onclick = openDiagModal;
}

/* ----------------------- Exportar / importar ---------------------------- */
export async function exportData() {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tareas-backup-${ymd(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Copia exportada', 'ok');
}

export async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!hasGroup()) return toast('Crea antes un grupo', 'err');
    await db.importAll(payload, { merge: true, fallbackGroupId: G().id });
    toast('Datos importados', 'ok');
    scheduleAutoSync();
    await refresh();
  } catch (err) { toast('Archivo no válido', 'err'); }
  e.target.value = '';
}
