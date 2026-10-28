/* Versión del producto y registro de cambios.
 *
 * Al publicar cambios:
 *   1. Sube APP_VERSION siguiendo SemVer (MAJOR.MINOR.PATCH).
 *   2. Añade una entrada arriba del array CHANGELOG.
 *   3. Actualiza CACHE_VERSION en sw.js con el mismo número (v + versión).
 *
 * Tipos de cambio: "add" (nuevo), "chg" (cambio/mejora), "fix" (corrección).
 */
export const APP_VERSION = '1.1.0';

export const CHANGELOG = [
  {
    version: '1.1.0',
    date: '2026-10-28',
    changes: [
      { type: 'add', text: 'Notificaciones con ntfy: aviso a todo el hogar al crear una tarea (catálogo o semana) o al completarla.' },
      { type: 'add', text: 'Cola de avisos sin conexión: se envían al recuperar la red.' },
      { type: 'add', text: 'Compartir configuración (sincronización y notificaciones) con la pareja mediante un enlace o código.' },
      { type: 'chg', text: 'La sincronización también se hace al abrir la app, al volver a ella, al recuperar la red y cada minuto mientras está abierta.' },
      { type: 'chg', text: 'Nuevo icono de la app: una casa.' },
      { type: 'chg', text: 'Todos los iconos de la interfaz son ahora SVG monocromáticos (adiós a los emojis).' },
      { type: 'chg', text: 'Se vuelve a pedir almacenamiento persistente tras el primer toque en la app.' }
    ]
  },
  {
    version: '1.0.0',
    date: '2026-07-20',
    changes: [
      { type: 'add', text: 'Primera versión: control de tareas del hogar con tema oscuro por defecto.' },
      { type: 'add', text: 'Almacenamiento local con IndexedDB y solicitud de almacenamiento persistente.' },
      { type: 'add', text: 'Crear y eliminar tareas, y gestionar personas (miembros del hogar).' },
      { type: 'add', text: 'Apuntar tareas realizadas y ver la actividad del día.' },
      { type: 'add', text: 'Planificador semanal para repartir tareas por día y persona.' },
      { type: 'add', text: 'Estadísticas: reparto por persona, porcentajes, puntos y ranking.' },
      { type: 'add', text: 'Sincronización familiar opcional mediante Google Sheets (Google Apps Script).' },
      { type: 'add', text: 'Ajustes: color de acento, tema claro/oscuro, sincronización y exportar/importar datos.' },
      { type: 'add', text: 'Instalable como PWA con funcionamiento offline.' }
    ]
  }
];
