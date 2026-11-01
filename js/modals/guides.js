/* Guías: configurar Google Sheets y suscribirse a los avisos de ntfy. */
import { icon } from '../icons.js';
import { isValidTopic, topicUrl } from '../notify.js';
import { G } from '../state.js';
import { $, esc, toast, openModal } from '../ui.js';

/* ---------------------- Guía de Google Sheets --------------------------- */
const AUTHORIZE = `elige la función <code>instalarResumenDiario</code> en el desplegable de arriba y pulsa <b>Ejecutar</b> → Revisar permisos → tu cuenta → Configuración avanzada → Ir a … (no seguro) → <b>Permitir</b>`;

/** Instalar el script (o, con update, actualizar el que ya tienes publicado). */
export function openGuideModal({ update = false } = {}) {
  openModal(update ? 'Actualizar el script de Google' : 'Configurar Google Sheets', `
    <ol style="padding-left:20px;line-height:1.6;font-size:14px">
      ${update ? `<li>Abre tu Google Sheet → <b>Extensiones → Apps Script</b>.</li>` : `<li>Crea una <b>Google Sheet</b> nueva (hoja de cálculo en blanco).</li>
      <li>Menú <b>Extensiones → Apps Script</b>.</li>`}
      <li>Borra el contenido y <b>pega este código</b> (y guarda):</li>
    </ol>
    <div style="position:relative;margin:10px 0">
      <pre style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;overflow:auto;max-height:220px;font-size:11px;line-height:1.4"><code id="gs-code"></code></pre>
      <button class="btn btn--sm" id="gs-copy" style="position:absolute;top:8px;right:8px">${icon('copy')}Copiar</button>
    </div>
    <ol start="${update ? 3 : 4}" style="padding-left:20px;line-height:1.6;font-size:14px">
      <li><b>Autorízalo:</b> ${AUTHORIZE}. Así también se activa el resumen diario. Sin esto la app da «Acceso denegado».</li>
      ${update ? `<li><b>Implementar → Gestionar implementaciones</b> → lápiz → Versión: <b>Nueva versión</b> → <b>Implementar</b>. La URL no cambia.</li>
      <li>En la app pulsa <b>sincronizar</b>: en Grupo debería poner «script v2».</li>` : `<li>Pulsa <b>Implementar → Nueva implementación</b>.</li>
      <li>Tipo: <b>Aplicación web</b>. Ejecutar como: <b>Yo</b>. Quién tiene acceso: <b>Cualquier usuario</b>.</li>
      <li>Copia la <b>URL</b> que termina en <code>/exec</code>, pégala en Grupo → Compartir tareas y pulsa <b>Guardar</b>.</li>
      <li>Pulsa <b>Invitar a alguien</b>: la invitación ya lleva la URL, tu pareja no tiene que copiar nada.</li>`}
    </ol>
    <p class="help">El aviso de «no seguro» sale porque el script es tuyo y Google no lo ha revisado. Para comprobarlo, abre la URL en incógnito: debe mostrar <code>{"ok":true,…}</code>. Si cambias el código, crea una <b>nueva versión</b> de la implementación. Para probar el resumen, ejecuta <code>enviarResumenAhora</code>. Si añades una <code>SECRET</code> en el código, ponla también en el campo "Clave secreta".</p>
    <div class="modal__actions"><button class="btn btn--primary btn--block" data-close>Entendido</button></div>
  `, {
    wide: true,
    onMount(modal) {
      // El código es el mismo archivo apps-script/Code.gs (está en la caché del Service Worker).
      const codeEl = $('#gs-code', modal);
      const code = fetch('apps-script/Code.gs').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
      codeEl.textContent = 'Cargando…';
      code.then((text) => { codeEl.textContent = text; })
        .catch(() => { codeEl.textContent = 'No se pudo cargar el código. Cópialo de apps-script/Code.gs en el repositorio.'; });
      $('#gs-copy', modal).onclick = async () => {
        try { await navigator.clipboard.writeText(await code); toast('Código copiado', 'ok'); }
        catch { toast('Copia manualmente', 'err'); }
      };
    }
  });
}

/* ------------------------ Guía de notificaciones ------------------------ */
export function openNotifyGuideModal({ ntfyServer, ntfyTopic }) {
  const topic = isValidTopic(ntfyTopic) ? ntfyTopic : '';
  const customServer = ntfyServer && ntfyServer.replace(/\/+$/, '') !== 'https://ntfy.sh';
  openModal('Recibir avisos en el móvil', `
    <ol style="padding-left:20px;line-height:1.6;font-size:14px">
      <li>Instala la app gratuita <b>ntfy</b>:
        <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a> ·
        <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a>.</li>
      <li>Vuelve aquí y pulsa <b>Suscribirme en la app ntfy</b>. Si no se abre (o usas iPhone), en ntfy pulsa <b>+</b> (Suscribirse a un tema) y escribe tu tema:</li>
    </ol>
    ${topic ? `<div class="input-group" style="margin:4px 0 12px">
        <input class="input" value="${esc(topic)}" readonly id="ng-topic">
        <button class="btn" id="ng-copy" aria-label="Copiar tema">${icon('copy')}</button>
      </div>` : `<p class="help" style="margin:4px 0 12px">Primero activa «Recibir avisos en este móvil».</p>`}
    <ol start="3" style="padding-left:20px;line-height:1.6;font-size:14px">
      ${customServer ? `<li>Activa <b>Usar otro servidor</b> y escribe <code>${esc(ntfyServer)}</code>.</li>` : ''}
      <li>Si tu versión de ntfy lo permite, ponle como nombre visible <b>${esc(G().name)}</b>.</li>
      <li>Pulsa <b>Probar</b>: debería llegarte un aviso.</li>
      ${G().personal ? '' : '<li>Tu pareja activa «Recibir avisos» en su móvil: tendrá su propio tema.</li>'}
    </ol>
    <p class="help">Te llegará un aviso cuando otra persona añada o resuelva una tarea (lo que haces tú no te avisa). Si no hay conexión, el aviso se envía al recuperarla.</p>
    ${topic ? `<p class="help">También puedes verlos en el navegador: <a href="${esc(topicUrl(ntfyServer, topic))}" target="_blank" rel="noopener">${esc(topicUrl(ntfyServer, topic))}</a></p>` : ''}
    <div class="modal__actions"><button class="btn btn--primary btn--block" data-close>Entendido</button></div>
  `, {
    onMount(modal) {
      const copy = $('#ng-copy', modal);
      if (copy) copy.onclick = async () => {
        try { await navigator.clipboard.writeText(topic); toast('Tema copiado', 'ok'); }
        catch { $('#ng-topic', modal).select(); toast('Copia manualmente', 'err'); }
      };
    }
  });
}
