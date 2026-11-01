# Plan de desarrollo

Mejoras elegidas el 2026-10-30. Se hacen **de una en una**: cada paso termina con pruebas,
versión nueva y changelog, y se para para probarlo en el móvil antes de seguir.
Los números entre corchetes son los de la lista original de mejoras.

Estado: `[ ]` pendiente · `[~]` en curso · `[x]` hecho. **Todo hecho (v2.5.1 → v3.2.0).**

## Orden y motivo

1. **Fase 0 · Base**: pruebas, dividir `app.js`, diagnóstico y aviso de versión nueva. Todo lo
   demás se apoya en esto (las pruebas evitan romper lo que ya funciona al tocar tanto código).
2. **Fase 1 · Repeticiones**: días de la semana, contar desde que se hace y pausar. Las tres
   tocan el mismo modelo (`repeat` en `dates.js`) y el mismo trozo del modal: se diseñan juntas.
3. **Fase 2 · Flujo de tareas**: posponer, añadir escribiendo con naturalidad y rutinas. El
   lenguaje natural necesita el modelo de repetición ya cerrado («los lunes y jueves»).
4. **Fase 3 · Avisos**: un tema de ntfy por persona y aviso al asignar (este necesita el anterior
   para avisar solo a quien le toca).
5. **Fase 4 · Script de Google v2**: versión del script, sincronización incremental con limpieza
   y resumen diario. Las tres cambian `Code.gs`: van juntas para que solo haya que actualizar el
   script **una vez**. Va al final porque el resumen necesita los temas por persona y la lógica
   de repeticiones definitiva (hay que copiarla al script).

## Fase 0 · Base

- [x] **0.1 Pruebas automáticas [24]**
  - `package.json` mínimo (`"type": "module"`, sin dependencias) para importar `js/*.js` en Node.
  - `npm test` → `tools/test.mjs` (`node:test`): fechas y repeticiones, catálogo, changelog
    (`APP_VERSION` = primera entrada = `CACHE_VERSION`), iconos usados que existen, y que todo
    módulo importado esté en `APP_SHELL` del Service Worker (si falta uno, la app no funciona
    sin conexión).
  - `npm run smoke` → `tools/smoke.mjs`: Chrome headless + servidor estático + simulador del
    Web App, todo en Node. Recorre: arranque sin errores, crear grupo, añadir y resolver,
    repetida en Próximas, pestañas, Service Worker y recarga, y sincronización entre dos
    móviles (dos perfiles aislados).
- [x] **0.2 Dividir `app.js` [25]** (~1.760 líneas) sin cambiar comportamiento:
  - `ui.js` (helpers DOM, toasts, modales, formatos), `state.js` (estado, `G()`, `dueOf`),
    `actions.js` (resolver, deshacer, avisos), `sync-ui.js`, `groups.js` (crear, unirse,
    invitaciones), `views/*.js` (una por pestaña + onboarding), `modals/*.js`.
  - Sin dependencias circulares: el router registra `refresh` en `state.js`.
  - La guía de Google Sheets carga `apps-script/Code.gs` en vez de llevar una copia en
    `app.js` (desaparece el «si tocas uno, toca el otro»).
- [x] **0.3 Diagnóstico [12]**: registro local (últimos 100 eventos) de errores de
  sincronización (paso, estado HTTP, si fue CORS, trozo de la respuesta), de ntfy y de
  JavaScript. Ajustes → Diagnóstico con estado por grupo, «Copiar informe» (URL enmascarada,
  sin claves) y «Borrar». El toast de error de sincronización ofrece «Detalles».
- [x] **0.4 Aviso de versión nueva [13a]**: cuando el Service Worker se actualiza con la app
  abierta, toast «Hay una versión nueva · Recargar». Comprueba actualizaciones al volver a la
  app (Android deja la PWA abierta días).

## Fase 1 · Repeticiones

- [x] **1.1 Días de la semana [1]**: formato `repeat` = `'<N>w:<días>'` (ISO 1 = lunes):
  `'1w:1,4'` lunes y jueves, `'2w:6'` sábados alternos. Algoritmo sin ancla: el siguiente día
  marcado de la misma semana o, si no quedan, el primero de la semana N siguiente. Si la fecha
  elegida no es uno de los días, la primera pasa al siguiente día marcado (el modal lo muestra).
  UI: opción «Días de la semana…» con chips L M X J V S D y «cada [1] semanas». Etiquetas:
  «Lun y jue», «Entre semana», «Fines de semana».
- [x] **1.2 Contar desde que se hace [5]**: campo `repeatFrom: 'done'` en la tarea (solo
  intervalos, no días de la semana). Al resolver, la siguiente = día en que se hace + intervalo.
  No se agrupan repeticiones ni se proyectan en Próximas. `completeTodo` guarda `nextId` en la
  tarea resuelta para que «Deshacer» sepa qué borrar en cualquier modo.
- [x] **1.3 Pausar [22]**: por tarea («hasta el [fecha]» o «hasta que la reanude») y **modo
  vacaciones** del grupo (todas las repetidas hasta una fecha). Pausar hasta una fecha = mover
  la tarea a su primera repetición ≥ esa fecha (deja de salir en Hoy sin lógica extra) +
  `pausedUntil` para la etiqueta. Sin fecha: `paused: true`, sección «En pausa» en Próximas.

## Fase 2 · Flujo de tareas

- [x] **2.1 Posponer [3]**: en el modal de una pendiente, botones «Mañana», «+1 semana» y
  «Otro día». En una repetida solo mueve esa vez: guarda `seriesDue` (fecha original) y la
  siguiente se calcula con el calendario de la serie. Ajuste por grupo «Las tareas sin hacer
  pasan a hoy» (solo cambia cómo se muestran las no repetidas; apagado por defecto).
- [x] **2.2 Escribir con naturalidad [18]**: `js/parse.js` (puro, con muchas pruebas). Entiende
  «hoy / mañana / pasado mañana», «el viernes», «el 15 (de noviembre)», «15/11», «dentro de 3
  días», «la semana que viene», «cada día / semana / mes / año», «cada 2 semanas», «cada 10
  días», «los lunes y jueves», «entre semana», «fines de semana» y «para Ana». En el buscador de
  Hoy y en el título del modal: muestra lo entendido como chips (tocar uno lo descarta) y deja
  el título limpio («Sacar el vidrio»).
- [x] **2.3 Rutinas [20]**: almacén sincronizado `routines` `{id, groupId, name, icon,
  items:[{title, icon}], order}` (DB v4). En Hoy, fila «Rutinas»: toque = añade para hoy las que
  no estén ya pendientes (toast con Deshacer, un solo aviso «Juan ha añadido Limpieza del
  sábado (5)»); pulsación larga = editar (nombre, icono, tareas del catálogo o nuevas).

## Fase 3 · Avisos

- [x] **3.1 Un tema por persona [9]**: cada miembro guarda su `ntfyTopic` (sincronizado). Se
  publica en el tema de los **demás**, así nadie recibe sus propios avisos. Grupo → Avisos:
  «Recibir avisos en este móvil» + botón para suscribirse en la app ntfy. Desaparece el tema
  del grupo (la invitación ya no lo lleva). En un grupo privado no hay avisos de crear/resolver
  (solo el resumen diario de la fase 4).
- [x] **3.2 Aviso al asignar [8]**: al crear o cambiar «¿A quién le toca?» a otra persona, solo
  ella recibe «Juan te ha asignado «Sacar la basura» para mañana»; los demás, el aviso normal.

## Fase 4 · Script de Google v2 (una sola actualización del script)

- [x] **4.1 Versión del script [13b]**: `Code.gs` responde `version`. Si es más antigua de lo
  que la app necesita, aviso en Grupo con los pasos para actualizarlo (pegar código, ejecutar
  para autorizar, nueva versión).
- [x] **4.2 Sincronización incremental y limpieza [10]**:
  - El script numera cada cambio (`rev`, columna nueva que se añade sola) y una sola petición
    POST hace todo: la app envía lo cambiado desde su último envío y recibe lo cambiado desde
    su último `rev`. La clave deja de ir en la URL.
  - Limpieza (como mucho una vez al día): hechas de más de **90 días** y borradas de más de
    **60 días** pasan a una pestaña `archivo` de la hoja. Un móvil que lleve más tiempo sin
    sincronizar recibe la lista completa y quita lo que ya no existe.
  - La app aplica la misma limpieza en local (también en grupos sin hoja).
- [x] **4.3 Resumen diario [7]**: activador horario del script. A la hora que elija cada persona
  (guardada en su miembro, por defecto 8:00) envía a su tema «Hoy: 4 tareas (2 atrasadas)» con
  la lista y las suyas marcadas; si no hay nada, no envía. Se instala ejecutando una vez
  `instalarResumenDiario` en el editor (pide permiso para conectarse a ntfy). La lógica de
  fechas se copia de `dates.js` y una prueba compara las dos con muchos casos.

## Decisiones tomadas (cambiables)

- Días de la semana también con «cada 2 semanas» (cuesta lo mismo).
- Posponer una repetida mueve solo esa vez; la serie sigue su calendario.
- «Las tareas sin hacer pasan a hoy»: ajuste por grupo, apagado por defecto.
- Grupo privado: sin avisos de crear/resolver; solo el resumen diario.
- Historial: 90 días de hechas y 60 de borradas; lo viejo se archiva en la hoja, no se pierde.
- Resumen diario: hora por persona (8:00 por defecto); no se envía si no hay tareas.
- Rutinas solo manuales (un toque); sin programarlas.

## Riesgos a vigilar

- Cambiar los servicios que usa `Code.gs` (fase 4) obliga a **volver a autorizar** el script;
  si no, Google responde 403 como ya pasó. Las instrucciones y el diagnóstico lo explicarán.
- Si dos móviles resuelven a la vez una tarea «desde que se hace» en días distintos, pueden
  quedar dos repeticiones (el id ya no coincide). Es raro; se acepta.
