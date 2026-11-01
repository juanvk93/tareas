# Registro de cambios

Todos los cambios relevantes de **Tareas**. Versión actual: **3.2.0**.

> Archivo generado desde `js/changelog.js` con `node tools/gen_changelog.mjs`. No editar a mano.

## [3.2.0] — 2026-10-30

### Añadido

- Resumen diario: en Grupo → Avisos al móvil elige la hora y cada día te llega lo pendiente para hoy, aunque nadie abra la app (lo envía tu script de Google).
- El historial antiguo (hechas de hace más de 90 días y borradas de hace más de 60) pasa a la pestaña «archivo» de la hoja y deja de sincronizarse.
- Si tu script de Google es antiguo, Grupo lo avisa y explica cómo actualizarlo; mientras tanto la app sigue sincronizando como antes.

### Cambiado

- Sincronización mucho más rápida: solo se envía y se recibe lo que ha cambiado.

### Corregido

- Al guardar la configuración de Google Sheets mientras se sincronizaba en segundo plano, no se veía el resultado con la URL nueva.

## [3.1.0] — 2026-10-30

### Añadido

- Aviso al asignar: si una tarea le toca a otra persona, le llega «Juan te ha asignado «Sacar la basura» para mañana» (al crearla o al cambiar «¿A quién le toca?»).

### Corregido

- Los avisos de tareas atrasadas decían «para el Ayer»; ahora dicen «de ayer».

## [3.0.0] — 2026-10-30

### Añadido

- «Suscribirme en la app ntfy»: en Android abre ntfy y se suscribe a tu tema con un toque. «Probar» envía el aviso a tu propio tema.
- En Grupo se ve qué miembros reciben avisos.

### Cambiado

- Avisos: ahora cada persona tiene su propio tema de ntfy, así nadie recibe avisos de lo que hace él mismo. Hay que volver a activarlos y suscribirse (Grupo → Avisos al móvil).
- En los grupos privados ya no hay avisos al añadir o resolver (los cambios los haces tú).

## [2.12.0] — 2026-10-30

### Añadido

- Rutinas en Hoy: un toque añade de golpe todas sus tareas para hoy (sin duplicar las que ya estén pendientes), con Deshacer y un solo aviso al grupo.
- «Nueva rutina» para crear las tuyas con tareas del catálogo o escritas; mantén pulsada una rutina para editarla o eliminarla.
- Los grupos nuevos traen de ejemplo «Limpieza del sábado». Las rutinas se comparten con el grupo.

## [2.11.0] — 2026-10-30

### Añadido

- Escribe con naturalidad en «¿Qué hay que hacer?»: «Sacar el vidrio el viernes cada 2 semanas», «Regar las plantas los lunes y jueves», «Pagar el alquiler el 1 de cada mes», «Comprar pan para Ana»… La tarea se crea con su fecha, repetición y persona.
- Lo entendido aparece como chips debajo del buscador; toca uno para descartarlo.
- En el formulario de tarea nueva, si escribes así aparece «Aplicar» para rellenar fecha, repetición y persona.

## [2.10.0] — 2026-10-30

### Añadido

- Posponer: al editar una tarea pendiente (mantén pulsada su casilla en Hoy), «Mañana», «+1 semana» u «Otro día», con Deshacer.
- En las tareas que se repiten, posponer mueve solo esa vez: las siguientes siguen su calendario.
- Grupo → Tareas sin hacer → «Pasan a hoy»: las tareas sin repetición que se quedaron sin hacer salen como de hoy en vez de como atrasadas.

## [2.9.0] — 2026-10-30

### Añadido

- Pausar una tarea que se repite: al editarla, «Pausar hasta ese día» (vuelve sola el primer día que le toque) o «Pausar sin fecha».
- Las tareas en pausa sin fecha aparecen en Próximas → «En pausa», con un botón para reanudarlas.
- Modo vacaciones (Grupo → Vacaciones): pausa todas las tareas que se repiten hasta una fecha, para todo el grupo, y se puede reanudar antes.

## [2.8.0] — 2026-10-30

### Añadido

- Repetir contando desde el día en que se hace: «Contar desde el día en que se haga» (por ejemplo, limpiar filtros cada 10 días desde la última vez). Si se hace tarde, la siguiente también se retrasa.

### Corregido

- «Deshacer» una tarea repetida resuelta quita siempre la repetición que se había creado, aunque se deshaga otro día.

## [2.7.0] — 2026-10-30

### Añadido

- Repetir en días concretos de la semana: «Días de la semana…» permite elegir, por ejemplo, lunes y jueves para la basura, entre semana o fines de semana.
- También cada 2 o más semanas en esos días (por ejemplo, sábados alternos).

### Cambiado

- Si la fecha elegida no es uno de los días marcados, la tarea empieza el siguiente día marcado (el formulario indica cuándo será la primera vez).

## [2.6.1] — 2026-10-30

### Añadido

- Cuando se publica una versión nueva con la app abierta aparece «Versión X disponible · Recargar».

### Cambiado

- Al volver a la app se comprueba si hay versión nueva (aunque lleve días abierta).

## [2.6.0] — 2026-10-30

### Añadido

- Diagnóstico (Ajustes → Diagnóstico): estado de cada grupo, últimos errores de sincronización, de avisos y de la app, con lo que respondió Google o ntfy.
- «Copiar informe» para enviar el diagnóstico sin URLs completas, claves ni temas de ntfy.
- Un punto rojo en el botón de sincronizar avisa de que el último intento falló; los errores ofrecen «Detalles».

### Cambiado

- Mensajes de error más claros: clave secreta incorrecta, respuesta de Google y motivo que da ntfy.

## [2.5.2] — 2026-10-30

### Cambiado

- La guía «Cómo configurar Google Sheets» muestra siempre el código más reciente del script.
- Mejoras internas: el código de la app se ha reorganizado en piezas más pequeñas, sin cambios visibles.

## [2.5.1] — 2026-10-30

### Cambiado

- Pruebas automáticas antes de publicar: detectan fallos como el de la app en blanco tras actualizar.

### Corregido

- El icono de calendario ya se puede elegir para cualquier tarea (antes «Pedir cita» lo usaba, pero no salía en la lista de iconos).

## [2.5.0] — 2026-10-30

### Añadido

- Más opciones para repetir tareas: cada 2 o 3 semanas, cada 2, 3 o 6 meses y cada año.
- Repetición personalizada: «Cada N días, semanas, meses o años» (por ejemplo, cada 10 días).

## [2.4.2] — 2026-10-29

### Cambiado

- La guía «Cómo configurar Google Sheets» incluye el paso que faltaba: ejecutar el script una vez para autorizarlo.

### Corregido

- La app instalada podía quedarse vacía (v0.0.0 y sin poder cambiar de pestaña) tras una actualización: ahora cada versión se descarga completa y, si aun así no arranca, aparece un botón «Reparar y recargar».
- Google Sheets: en vez de «Failed to fetch», la app explica qué falla (URL que no termina en /exec, implementación que no es pública o script sin pegar).

## [2.4.1] — 2026-10-29

### Cambiado

- Al resolver una tarea repetida desde Hoy se planifica la siguiente fecha, igual que se ve en Próximas.

### Corregido

- Las tareas que se repiten aparecen en Hoy el día que les toca, aunque la repetición anterior no se resolviera (antes salían como atrasadas con la fecha vieja).

## [2.4.0] — 2026-10-29

### Añadido

- Catálogo personalizable por grupo: crea, renombra, reordena y elimina categorías, y añade tus propias tareas habituales.
- Las tareas nuevas se pueden guardar en una categoría: desde el aviso al añadirlas, desde el formulario o manteniéndolas pulsadas.
- Al planificar, «Elegir de tus tareas» muestra tu catálogo y las recientes, filtrables por categoría.

### Cambiado

- La aplicación pasa a llamarse «Tareas».
- Planificar desde Próximas abre el formulario con «Otro día» marcado.

### Corregido

- Las tareas que se repiten ya aparecen en Próximas (como repeticiones previstas) sin tener que resolver antes la actual.

## [2.3.0] — 2026-10-28

### Añadido

- En la pestaña Grupo puedes cambiar el tipo de grupo: compartido o privado.
- Interruptor «Enviar avisos» por grupo: al apagarlo se ocultan los ajustes de ntfy.
- Al crear un grupo eliges si quieres avisos al móvil.

### Cambiado

- Los grupos «personales» pasan a llamarse «privados» (icono de candado).
- El selector de grupos indica qué grupos no tienen avisos.

## [2.2.0] — 2026-10-28

### Añadido

- Varios grupos: ten un grupo compartido con tu pareja y otro personal con tus propias tareas.
- Selector de grupo en la cabecera: toca el nombre del grupo para cambiar de lista o crear uno nuevo.
- Grupos personales: solo para ti, sin miembros ni invitación; Google Sheets opcional para usarlos en varios dispositivos.

### Cambiado

- Cada grupo tiene su propia Google Sheet y su propio tema de avisos, y todos se sincronizan en segundo plano.
- Abrir una invitación añade el grupo sin tener que salir de los que ya tienes.
- Tu configuración anterior se convierte automáticamente en tu primer grupo.

## [2.1.0] — 2026-10-28

### Añadido

- Al actualizar la app se muestran automáticamente las novedades de la nueva versión.
- Toca el número de versión de la cabecera para ver el registro de cambios.
- Registro de cambios también en el repositorio (CHANGELOG.md).

## [2.0.0] — 2026-10-28

### Añadido

- Grupos: crea un grupo (p. ej. «Tareas Hogar») o únete con una invitación. Cada móvil define su persona.
- Tareas pendientes compartidas para hoy o planificadas para otro día, con repetición diaria, semanal o mensual.
- Pantalla Hoy al estilo de una lista de la compra: casillas grandes, catálogo de tareas habituales y recientes.
- Pestañas Próximas (lo planificado) y Hechas (historial y resumen de la semana).
- Invitar a alguien: un enlace con el grupo, Google Sheets y el tema de ntfy, sin copiar nada a mano.

### Cambiado

- La configuración de Google Sheets y ntfy pasa a la pestaña Grupo.
- Se retiran el catálogo con puntos, el planificador semanal y las estadísticas.

## [1.1.1] — 2026-10-28

### Corregido

- Estadísticas: más separación entre el selector de periodo y los contadores.

## [1.1.0] — 2026-10-28

### Añadido

- Notificaciones con ntfy: aviso a todo el hogar al crear una tarea (catálogo o semana) o al completarla.
- Cola de avisos sin conexión: se envían al recuperar la red.
- Compartir configuración (sincronización y notificaciones) con la pareja mediante un enlace o código.

### Cambiado

- La sincronización también se hace al abrir la app, al volver a ella, al recuperar la red y cada minuto mientras está abierta.
- Nuevo icono de la app: una casa.
- Todos los iconos de la interfaz son ahora SVG monocromáticos (adiós a los emojis).
- Se vuelve a pedir almacenamiento persistente tras el primer toque en la app.

## [1.0.0] — 2026-07-20

### Añadido

- Primera versión: control de tareas del hogar con tema oscuro por defecto.
- Almacenamiento local con IndexedDB y solicitud de almacenamiento persistente.
- Crear y eliminar tareas, y gestionar personas (miembros del hogar).
- Apuntar tareas realizadas y ver la actividad del día.
- Planificador semanal para repartir tareas por día y persona.
- Estadísticas: reparto por persona, porcentajes, puntos y ranking.
- Sincronización familiar opcional mediante Google Sheets (Google Apps Script).
- Ajustes: color de acento, tema claro/oscuro, sincronización y exportar/importar datos.
- Instalable como PWA con funcionamiento offline.
