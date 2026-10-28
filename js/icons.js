/* Iconos SVG monocromáticos (trazo, 24×24) que heredan el color con currentColor.
 *
 * Uso: icon('home') devuelve el <svg> como string para insertarlo en el HTML.
 * El tamaño sigue al font-size del contenedor (1em), salvo que se pase otro.
 *
 * Las tareas guardan la clave del icono en el campo `icon`. Los registros
 * antiguos (v1.0.0) tenían un emoji en `emoji`: taskIcon() los traduce.
 */

const PATHS = {
  /* ------------------------------ Interfaz ------------------------------ */
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  list: '<path d="m3 6 2 2 3-3M3 13l2 2 3-3M11 6.5h10M11 13.5h10M11 19.5h10M4.5 19.5h.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-8"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L3 9"/><path d="M3 4v5h5"/><path d="M4 13a8 8 0 0 0 14.6 4.5L21 15"/><path d="M21 20v-5h-5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5M4 21h16"/>',
  book: '<path d="M4 19V5a2 2 0 0 1 2-2h14v15H6a2 2 0 0 0-2 2Z"/><path d="M20 18v3H6a2 2 0 0 1-2-2"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"/><path d="M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2.5h6v3H9zM9 10h6M9 14h6M9 18h3"/>',
  trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8M9 18h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/>',
  heart: '<path d="M12 20s-7-4.4-9-9A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 9 5c-2 4.6-9 9-9 9Z"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>',

  /* ------------------------------- Tareas ------------------------------- */
  sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4"/>',
  dishes: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/>',
  broom: '<path d="m20 4-8.5 8.5"/><path d="M9 10l5 5-3 5-8 1 1-8Z"/><path d="m7.5 15.5-2.5 4M10.5 16.5 8 20.5"/>',
  spray: '<path d="M9 8h6v3l2 2v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-8l2-2V8Z"/><path d="M10 8V4h5l2 2M19.5 3.5v.01M19.5 7v.01M21.5 5.2v.01"/>',
  toilet: '<rect x="5" y="3" width="8" height="7" rx="1"/><path d="M3 10h16a7 7 0 0 1-7 7H9.5l.5 4H6l.6-4.5A7 7 0 0 1 3 10Z"/>',
  bath: '<path d="M3 12h18v3a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-3Z"/><path d="M5 12V5.5A2.5 2.5 0 0 1 9.5 4M7 20l-1 2M17 20l1 2M9 6.5h2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
  basket: '<path d="M3 9h18l-2 11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1L3 9Z"/><path d="m8 9 3-6M16 9l-3-6M8 13v4M12 13v4M16 13v4"/>',
  washer: '<rect x="4" y="2.5" width="16" height="19" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M8 6h.01M11 6h.01M9.5 13a2.5 2.5 0 0 0 3 2"/>',
  shirt: '<path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0Z"/>',
  iron: '<path d="M3 18h18v-3a6 6 0 0 0-6-6H8a3 3 0 0 0-2.8 2L3 18Z"/><path d="M9 9V6h8"/>',
  cooking: '<circle cx="10" cy="15" r="6"/><path d="M16 15h6"/><path d="M8 3c0 1 1 1 1 2s-1 1-1 2M12 3c0 1 1 1 1 2s-1 1-1 2"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6"/>',
  paw: '<circle cx="5" cy="10" r="2"/><circle cx="9" cy="5" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="19" cy="10" r="2"/><path d="M12 11c-3 0-6 4-6 7a3 3 0 0 0 3 3c1.2 0 2-.6 3-.6s1.8.6 3 .6a3 3 0 0 0 3-3c0-3-3-7-6-7Z"/>',
  plant: '<path d="M12 21v-9M7 21h10"/><path d="M12 12C12 8 9 5 4 5c0 4 3 7 8 7ZM12 14c0-3 2.5-6 7-6 0 3.5-2.5 6-7 6Z"/>',
  window: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M4 12h16"/>',
  bed: '<path d="M3 6v14M3 16h18M21 20v-7a3 3 0 0 0-3-3h-8v6"/><circle cx="6.5" cy="12" r="2"/>',
  bucket: '<path d="M5 9h14l-1.5 11a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1L5 9Z"/><path d="M5 9a7 7 0 0 1 14 0M9 13v4"/>',
  droplet: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
  car: '<path d="M5 17H3v-5l2-5a2 2 0 0 1 2-1.5h10A2 2 0 0 1 19 7l2 5v5h-2"/><path d="M3 12h18M9 17h6"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  pill: '<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="m8.5 8.5 7 7"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>'
};

/** Iconos que se ofrecen al crear una tarea (orden del selector). */
export const TASK_ICONS = [
  'sparkles', 'dishes', 'broom', 'spray', 'toilet', 'bath', 'trash', 'basket', 'washer', 'shirt',
  'iron', 'cooking', 'cart', 'paw', 'plant', 'window', 'bed', 'bucket', 'droplet', 'car', 'pill', 'box'
];

/* Equivalencias de los emojis de la v1.0.0 con los iconos nuevos. */
const EMOJI_TO_ICON = {
  '🧽': 'sparkles', '🍽️': 'dishes', '🍽': 'dishes', '🧹': 'broom', '🧴': 'spray', '🚽': 'toilet',
  '🛁': 'bath', '🗑️': 'trash', '🗑': 'trash', '🧺': 'basket', '👕': 'shirt', '🍳': 'cooking',
  '🛒': 'cart', '🐕': 'paw', '🌱': 'plant', '🪟': 'window', '🛏️': 'bed', '🛏': 'bed', '🧻': 'box',
  '🚗': 'car', '💊': 'pill', '📦': 'box', '🧼': 'droplet'
};

export function icon(name, { size, cls = '' } = {}) {
  const body = PATHS[name] || PATHS.help;
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg class="ico ${cls}"${dim} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Clave de icono de una tarea (con compatibilidad para registros con emoji). */
export function taskIconName(task) {
  if (!task) return 'help';
  if (task.icon && PATHS[task.icon]) return task.icon;
  return EMOJI_TO_ICON[task.emoji] || 'sparkles';
}
export function taskIcon(task, opts) { return icon(taskIconName(task), opts); }
