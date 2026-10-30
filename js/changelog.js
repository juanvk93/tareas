/* Versión del producto y registro de cambios (fuente única).
 *
 * Se muestra en la app (cabecera → versión, Ajustes → Novedades y
 * automáticamente tras actualizar) y se vuelca a CHANGELOG.md con
 * `node tools/gen_changelog.mjs`.
 *
 * Al publicar cambios:
 *   1. Sube APP_VERSION siguiendo SemVer (MAJOR.MINOR.PATCH).
 *   2. Añade una entrada arriba del array CHANGELOG.
 *   3. Actualiza CACHE_VERSION en sw.js con el mismo número (v + versión).
 *   4. Regenera CHANGELOG.md: node tools/gen_changelog.mjs
 *
 * Tipos de cambio: "add" (nuevo), "chg" (cambio/mejora), "fix" (corrección).
 */
export const APP_VERSION = '2.5.0';

export const CHANGELOG = [
  {
    version: '2.5.0',
    date: '2026-10-30',
    changes: [
      { type: 'add', text: 'Más opciones para repetir tareas: cada 2 o 3 semanas, cada 2, 3 o 6 meses y cada año.' },
      { type: 'add', text: 'Repetición personalizada: «Cada N días, semanas, meses o años» (por ejemplo, cada 10 días).' }
    ]
  },
  {
    version: '2.4.2',
    date: '2026-10-29',
    changes: [
      { type: 'fix', text: 'La app instalada podía quedarse vacía (v0.0.0 y sin poder cambiar de pestaña) tras una actualización: ahora cada versión se descarga completa y, si aun así no arranca, aparece un botón «Reparar y recargar».' },
      { type: 'fix', text: 'Google Sheets: en vez de «Failed to fetch», la app explica qué falla (URL que no termina en /exec, implementación que no es pública o script sin pegar).' },
      { type: 'chg', text: 'La guía «Cómo configurar Google Sheets» incluye el paso que faltaba: ejecutar el script una vez para autorizarlo.' }
    ]
  },
  {
    version: '2.4.1',
    date: '2026-10-29',
    changes: [
      { type: 'fix', text: 'Las tareas que se repiten aparecen en Hoy el día que les toca, aunque la repetición anterior no se resolviera (antes salían como atrasadas con la fecha vieja).' },
      { type: 'chg', text: 'Al resolver una tarea repetida desde Hoy se planifica la siguiente fecha, igual que se ve en Próximas.' }
    ]
  },
  {
    version: '2.4.0',
    date: '2026-10-29',
    changes: [
      { type: 'chg', text: 'La aplicación pasa a llamarse «Tareas».' },
      { type: 'add', text: 'Catálogo personalizable por grupo: crea, renombra, reordena y elimina categorías, y añade tus propias tareas habituales.' },
      { type: 'add', text: 'Las tareas nuevas se pueden guardar en una categoría: desde el aviso al añadirlas, desde el formulario o manteniéndolas pulsadas.' },
      { type: 'add', text: 'Al planificar, «Elegir de tus tareas» muestra tu catálogo y las recientes, filtrables por categoría.' },
      { type: 'chg', text: 'Planificar desde Próximas abre el formulario con «Otro día» marcado.' },
      { type: 'fix', text: 'Las tareas que se repiten ya aparecen en Próximas (como repeticiones previstas) sin tener que resolver antes la actual.' }
    ]
  },
  {
    version: '2.3.0',
    date: '2026-10-28',
    changes: [
      { type: 'add', text: 'En la pestaña Grupo puedes cambiar el tipo de grupo: compartido o privado.' },
      { type: 'add', text: 'Interruptor «Enviar avisos» por grupo: al apagarlo se ocultan los ajustes de ntfy.' },
      { type: 'add', text: 'Al crear un grupo eliges si quieres avisos al móvil.' },
      { type: 'chg', text: 'Los grupos «personales» pasan a llamarse «privados» (icono de candado).' },
      { type: 'chg', text: 'El selector de grupos indica qué grupos no tienen avisos.' }
    ]
  },
  {
    version: '2.2.0',
    date: '2026-10-28',
    changes: [
      { type: 'add', text: 'Varios grupos: ten un grupo compartido con tu pareja y otro personal con tus propias tareas.' },
      { type: 'add', text: 'Selector de grupo en la cabecera: toca el nombre del grupo para cambiar de lista o crear uno nuevo.' },
      { type: 'add', text: 'Grupos personales: solo para ti, sin miembros ni invitación; Google Sheets opcional para usarlos en varios dispositivos.' },
      { type: 'chg', text: 'Cada grupo tiene su propia Google Sheet y su propio tema de avisos, y todos se sincronizan en segundo plano.' },
      { type: 'chg', text: 'Abrir una invitación añade el grupo sin tener que salir de los que ya tienes.' },
      { type: 'chg', text: 'Tu configuración anterior se convierte automáticamente en tu primer grupo.' }
    ]
  },
  {
    version: '2.1.0',
    date: '2026-10-28',
    changes: [
      { type: 'add', text: 'Al actualizar la app se muestran automáticamente las novedades de la nueva versión.' },
      { type: 'add', text: 'Toca el número de versión de la cabecera para ver el registro de cambios.' },
      { type: 'add', text: 'Registro de cambios también en el repositorio (CHANGELOG.md).' }
    ]
  },
  {
    version: '2.0.0',
    date: '2026-10-28',
    changes: [
      { type: 'add', text: 'Grupos: crea un grupo (p. ej. «Tareas Hogar») o únete con una invitación. Cada móvil define su persona.' },
      { type: 'add', text: 'Tareas pendientes compartidas para hoy o planificadas para otro día, con repetición diaria, semanal o mensual.' },
      { type: 'add', text: 'Pantalla Hoy al estilo de una lista de la compra: casillas grandes, catálogo de tareas habituales y recientes.' },
      { type: 'add', text: 'Pestañas Próximas (lo planificado) y Hechas (historial y resumen de la semana).' },
      { type: 'add', text: 'Invitar a alguien: un enlace con el grupo, Google Sheets y el tema de ntfy, sin copiar nada a mano.' },
      { type: 'chg', text: 'La configuración de Google Sheets y ntfy pasa a la pestaña Grupo.' },
      { type: 'chg', text: 'Se retiran el catálogo con puntos, el planificador semanal y las estadísticas.' }
    ]
  },
  {
    version: '1.1.1',
    date: '2026-10-28',
    changes: [
      { type: 'fix', text: 'Estadísticas: más separación entre el selector de periodo y los contadores.' }
    ]
  },
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

/** Compara versiones SemVer: <0 si a<b, 0 si iguales, >0 si a>b. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}
