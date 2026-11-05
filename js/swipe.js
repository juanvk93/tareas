/* Deslizar filas y casillas hacia un lado para lanzar una acción (resolver, pasar a mañana…).
 * Mientras se desliza, detrás aparece un fondo de color con el icono y el texto de la acción. */
import { icon } from './icons.js';
import { esc } from './ui.js';

const COMMIT = 0.35; // Fracción del ancho que hay que deslizar para que, al soltar, se haga.
const MIN_PX = 64;

/**
 * @param {HTMLElement} el
 * @param {{left?: SwipeAction, right?: SwipeAction}} acts  right = deslizar hacia la derecha.
 * @typedef {{label: string, icon: string, cls?: string, run: () => any}} SwipeAction
 */
export function makeSwipeable(el, acts) {
  let x0 = 0, y0 = 0, dx = 0, mode = '', armed = false, swiped = false, bg = null;
  const side = () => (dx > 0 ? acts.right : acts.left);
  const cleanup = () => {
    bg?.remove(); bg = null;
    el.classList.remove('is-swiping');
    el.style.transform = ''; el.style.transition = '';
  };
  const paint = () => {
    const a = side();
    if (!bg) { bg = document.createElement('div'); el.before(bg); }
    bg.className = `swipe-bg swipe-bg--${dx > 0 ? 'right' : 'left'} ${a?.cls || ''} ${armed ? 'is-armed' : ''}`;
    Object.assign(bg.style, { top: `${el.offsetTop}px`, left: `${el.offsetLeft}px`, width: `${el.offsetWidth}px`, height: `${el.offsetHeight}px` });
    bg.innerHTML = a ? `${icon(a.icon)}<span>${esc(a.label)}</span>` : '';
  };

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; mode = ''; armed = false;
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (mode === 'v') return;
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (!mode) {
      if (Math.hypot(mx, my) < 10) return;
      mode = Math.abs(mx) > Math.abs(my) ? 'h' : 'v'; // En vertical manda el desplazamiento de la página.
      if (mode === 'v') return;
      el.classList.add('is-swiping');
    }
    dx = mx;
    if (!side()) dx = Math.sign(mx) * Math.min(20, Math.abs(mx) / 4); // Sin acción en ese lado: apenas se mueve.
    const now = !!side() && Math.abs(dx) >= Math.max(MIN_PX, el.offsetWidth * COMMIT);
    if (now && !armed) navigator.vibrate?.(10);
    armed = now;
    el.style.transform = `translateX(${dx}px)`;
    paint();
  }, { passive: true });

  const end = (cancel) => {
    if (mode !== 'h') { mode = ''; return; }
    mode = '';
    swiped = true; setTimeout(() => { swiped = false; }, 400);
    const a = armed && !cancel ? side() : null;
    el.style.transition = 'transform .18s ease-out';
    el.style.transform = a ? `translateX(${dx > 0 ? '' : '-'}${el.offsetWidth + 24}px)` : 'translateX(0)';
    setTimeout(async () => {
      if (!a) return cleanup();
      try { await a.run(); } finally { cleanup(); } // Normalmente la vista ya se ha repintado.
    }, 180);
  };
  el.addEventListener('touchend', () => end(false));
  el.addEventListener('touchcancel', () => end(true));
  // Tras deslizar no cuenta como toque (resolver, abrir el formulario).
  el.addEventListener('click', (e) => { if (swiped) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}
