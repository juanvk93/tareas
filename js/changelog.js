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
export const APP_VERSION = '3.2.0';

export const CHANGELOG = [
  {
    version: '3.2.0',
    date: '2026-10-30',
    changes: [
      { type: 'add', text: 'Resumen diario: en Grupo → Avisos al móvil elige la hora y cada día te llega lo pendiente para hoy, aunque nadie abra la app (lo envía tu script de Google).' },
      { type: 'chg', text: 'Sincronización mucho más rápida: solo se envía y se recibe lo que ha cambiado.' },
      { type: 'add', text: 'El historial antiguo (hechas de hace más de 90 días y borradas de hace más de 60) pasa a la pestaña «archivo» de la hoja y deja de sincronizarse.' },
      { type: 'add', text: 'Si tu script de Google es antiguo, Grupo lo avisa y explica cómo actualizarlo; mientras tanto la app sigue sincronizando como antes.' },
      { type: 'fix', text: 'Al guardar la configuración de Google Sheets mientras se sincronizaba en segundo plano, no se veía el resultado con la URL nueva.' }
    ]
  },
  {
    version: '3.1.0',
    date: '2026-10-30',
    changes: [
      { type: 'add', text: 'Aviso al asignar: si una tarea le toca a otra persona, le llega «Juan te ha asignado «Sacar la basura» para mañana» (al crearla o al cambiar «¿A quién le toca?»).' },
      { type: 'fix', text: 'Los avisos de tareas atrasadas decían «para el Ayer»; ahora dicen «de ayer».' }
    ]
  },
  {
    version: '3.0.0',
    date: '2026-10-30',
    changes: [
      { type: 'chg', text: 'Avisos: ahora cada persona tiene su propio tema de ntfy, así nadie recibe avisos de lo que hace él mismo. Hay que volver a activarlos y suscribirse (Grupo → Avisos al móvil).' },
      { type: 'add', text: '«Suscribirme en la app ntfy»: en Android abre ntfy y se suscribe a tu tema con un toque. «Probar» envía el aviso a tu propio tema.' },
      { type: 'add', text: 'En Grupo se ve qué miembros reciben avisos.' },
      { type: 'chg', text: 'En los grupos privados ya no hay avisos al añadir o resolver (los cambios los haces tú).' }
    ]
  },
  {
    version: '2.12.0',
    date: '2026-10-30',
    changes: [
      { type: 'add', text: 'Rutinas en Hoy: un toque añade de golpe todas sus tareas para hoy (sin duplicar las que ya estén pendientes), con Deshacer y un solo aviso al grupo.' },
      { type: 'add', text: '«Nueva rutina» para crear las tuyas con tareas del catálogo o escritas; mantén pulsada una rutina para editarla o eliminarla.' },
      { type: 'add', text: 'Los grupos nuevos traen de ejemplo «Limpieza del sábado». Las rutinas se comparten con el grupo.' }
    ]
  },
  {
    version: '2.11.0',
    date: '2026-10-30',
    changes: [
      { type: 'add', text: 'Escribe con naturalidad en «¿Qué hay que hacer?»: «Sacar el vidrio el viernes cada 2 semanas», «Regar las plantas los lunes y jueves», «Pagar el alquiler el 1 de cada mes», «Comprar pan para Ana»… La tarea se crea con su fecha, repetición y persona.' },
      { type: 'add', text: 'Lo entendido aparece como chips debajo del buscador; toca uno para descartarlo.' },
      { type: 'add', text: 'En el formulario de tarea nueva, si escribes así aparece «Aplicar» para rellenar fecha, repetición y persona.' }
    ]
  },
  {
    version: '2.10.0',
    date: '2026-10-30',
    changes: [
      { type: 'add', text: 'Posponer: al editar una tarea pendiente (mantén pulsada su casilla en Hoy), «Mañana», «+1 semana» u «Otro día», con Deshacer.' },
      { type: 'add', text: 'En las tareas que se repiten, posponer mueve solo esa vez: las siguientes siguen su calendario.' },
      { type: 'add', text: 'Grupo → Tareas sin hacer → «Pasan a hoy»: las tareas sin repetición que se quedaron sin hacer salen como de hoy en vez de como atrasadas.' }
    ]
  },
  {
    version: '2.9.0',
    date: '2026-10-30',
    changes: [
      { type: 'add', text: 'Pausar una tarea que se repite: al editarla, «Pausar hasta ese día» (vuelve sola el primer día que le toque) o «Pausar sin fecha».' },
      { type: 'add', text: 'Las tareas en pausa sin fecha aparecen en Próximas → «En pausa», con un botón para reanudarlas.' },
      { type: 'add', text: 'Modo vacaciones (Grupo → Vacaciones): pausa todas las tareas que se repiten hasta una fecha, para todo el grupo, y se puede reanudar antes.' }
    ]
  },
  {
    version: '2.8.0',
    date: '2026-10-30',
    changes: [
      { type: 'add', text: 'Repetir contando desde el día en que se hace: «Contar desde el día en que se haga» (por ejemplo, limpiar filtros cada 10 días desde la última vez). Si se hace tarde, la siguiente también se retrasa.' },
      { type: 'fix', text: '«Deshacer» una tarea repetida resuelta quita siempre la repetición que se había creado, aunque se deshaga otro día.' }
    ]
  },
  {
    version: '2.7.0',
    date: '2026-10-30',
    changes: [
      { type: 'add', text: 'Repetir en días concretos de la semana: «Días de la semana…» permite elegir, por ejemplo, lunes y jueves para la basura, entre semana o fines de semana.' },
      { type: 'add', text: 'También cada 2 o más semanas en esos días (por ejemplo, sábados alternos).' },
      { type: 'chg', text: 'Si la fecha elegida no es uno de los días marcados, la tarea empieza el siguiente día marcado (el formulario indica cuándo será la primera vez).' }
    ]
  },
  {
    version: '2.6.1',
    date: '2026-10-30',
    changes: [
      { type: 'add', text: 'Cuando se publica una versión nueva con la app abierta aparece «Versión X disponible · Recargar».' },
      { type: 'chg', text: 'Al volver a la app se comprueba si hay versión nueva (aunque lleve días abierta).' }
    ]
  },
  {
    version: '2.6.0',
    date: '2026-10-30',
    changes: [
      { type: 'add', text: 'Diagnóstico (Ajustes → Diagnóstico): estado de cada grupo, últimos errores de sincronización, de avisos y de la app, con lo que respondió Google o ntfy.' },
      { type: 'add', text: '«Copiar informe» para enviar el diagnóstico sin URLs completas, claves ni temas de ntfy.' },
      { type: 'add', text: 'Un punto rojo en el botón de sincronizar avisa de que el último intento falló; los errores ofrecen «Detalles».' },
      { type: 'chg', text: 'Mensajes de error más claros: clave secreta incorrecta, respuesta de Google y motivo que da ntfy.' }
    ]
  },
  {
    version: '2.5.2',
    date: '2026-10-30',
    changes: [
      { type: 'chg', text: 'La guía «Cómo configurar Google Sheets» muestra siempre el código más reciente del script.' },
      { type: 'chg', text: 'Mejoras internas: el código de la app se ha reorganizado en piezas más pequeñas, sin cambios visibles.' }
    ]
  },
  {
    version: '2.5.1',
    date: '2026-10-30',
    changes: [
      { type: 'fix', text: 'El icono de calendario ya se puede elegir para cualquier tarea (antes «Pedir cita» lo usaba, pero no salía en la lista de iconos).' },
      { type: 'chg', text: 'Pruebas automáticas antes de publicar: detectan fallos como el de la app en blanco tras actualizar.' }
    ]
  },
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
