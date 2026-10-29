# Registro de cambios

Todos los cambios relevantes de **Tareas**. Versión actual: **2.4.1**.

> Archivo generado desde `js/changelog.js` con `node tools/gen_changelog.mjs`. No editar a mano.

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
