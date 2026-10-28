# Registro de cambios

Todos los cambios relevantes de **Tareas del Hogar**. Versión actual: **2.1.0**.

> Archivo generado desde `js/changelog.js` con `node tools/gen_changelog.mjs`. No editar a mano.

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
