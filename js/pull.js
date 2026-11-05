/* Tirar hacia abajo desde arriba de cualquier pestaña = sincronizar el grupo activo.
 * El «tirar para recargar» del navegador está desactivado (overscroll-behavior en styles.css). */
import { icon } from './icons.js';
import { G } from './state.js';
import { $ } from './ui.js';
import { doSync } from './sync-ui.js';

export const PULL_TRIGGER = 64; // px (ya amortiguados) a partir de los que, al soltar, sincroniza.
const PULL_MAX = 100;
const DAMPING = 0.5;           // El indicador baja la mitad de lo que baja el dedo.

export function installPullToRefresh() {
  const el = document.createElement('div');
  el.className = 'ptr';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = icon('refresh');
  document.body.appendChild(el);

  let startX = 0, startY = 0, pull = 0, tracking = false, busy = false;
  const allowed = (target) => !busy && window.scrollY <= 0 && !!G()?.syncUrl && !$('.modal-overlay')
    && !document.body.classList.contains('no-group') && !target.closest('input, textarea, select');
  const reset = () => {
    el.classList.remove('is-visible', 'is-ready', 'is-spinning');
    el.style.transform = '';
    el.style.opacity = '';
  };

  document.addEventListener('touchstart', (e) => {
    tracking = e.touches.length === 1 && allowed(e.target);
    if (!tracking) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; pull = 0;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY;
    // De lado (deslizar una fila, las categorías) o con la página bajada: no es nuestro.
    if (window.scrollY > 0 || (!pull && Math.abs(dx) > Math.abs(dy))) { tracking = false; return reset(); }
    if (dy < 8) { pull = 0; return reset(); } // Zona muerta (y si vuelve hacia arriba, se cancela).
    pull = Math.min(PULL_MAX, dy * DAMPING);
    el.classList.add('is-visible');
    el.classList.toggle('is-ready', pull >= PULL_TRIGGER);
    el.style.opacity = String(Math.min(1, pull / PULL_TRIGGER));
    el.style.transform = `translate(-50%, ${pull}px) rotate(${pull * 3}deg)`;
  }, { passive: true });

  document.addEventListener('touchend', async () => {
    if (!tracking) return;
    tracking = false;
    if (pull < PULL_TRIGGER) return reset();
    busy = true;
    el.classList.add('is-spinning');
    el.style.transform = `translate(-50%, ${PULL_TRIGGER}px)`;
    try { await doSync(false); } finally { busy = false; reset(); }
  });
  document.addEventListener('touchcancel', () => { if (tracking) { tracking = false; reset(); } });
}
