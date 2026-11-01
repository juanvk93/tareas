# CLAUDE.md — Tareas

Guía para trabajar en este proyecto en futuras sesiones. Léela antes de tocar código.

## Qué es

PWA (Progressive Web App) **sin backend propio ni build step**: HTML + CSS + JavaScript
vanilla (ES modules) pensada para publicarse tal cual en **GitHub Pages**. Sirve para
que una pareja o familia comparta una **lista de tareas pendientes** (del hogar y otras), al
estilo de la app de lista de la compra *Bring*: un **grupo** con sus miembros, tareas para hoy
o planificadas para otro día (con repetición) y cualquiera puede marcarlas como resueltas.
Cada móvil puede estar en **varios grupos** (típicamente uno compartido y otro personal).

- **Tema oscuro por defecto** (claro opcional). Color de acento configurable.
- **Datos locales** en **IndexedDB** con solicitud de almacenamiento **persistente**.
- **Sincronización familiar opcional** vía **Google Sheets + Google Apps Script** (Web App).
- **Notificaciones opcionales** vía **ntfy** (la PWA publica directamente en ntfy.sh o en un servidor propio).
- **Iconos de la UI: SVG monocromáticos** (`js/icons.js`, `currentColor`). Nada de emojis en la interfaz.
- Instalable y **offline** gracias al Service Worker.

## Estructura de archivos

```
Tareas/
├── index.html              # Shell de la app (cabecera, <main>, tabbar). Casi todo se pinta desde JS.
├── manifest.webmanifest    # Manifiesto PWA (iconos, nombre, colores).
├── sw.js                   # Service Worker. OJO: CACHE_VERSION debe seguir a APP_VERSION.
├── .nojekyll               # Evita el procesado Jekyll en GitHub Pages.
├── css/
│   └── styles.css          # Todos los estilos. Variables de tema en :root y [data-theme="light"].
├── js/
│   ├── app.js              # Entrada: arranque, registro de vistas, wiring de cabecera y tabbar.
│   ├── state.js            # Estado de la UI (`state`), G(), hasGroup(), dueOf() y constantes.
│   ├── ui.js               # $, $$, esc, formatos, toast, openModal/confirmDialog, tema, cabecera.
│   ├── nav.js              # Router: setView, refresh, refreshKeepingScroll, registerViews.
│   ├── actions.js          # Resolver / deshacer y avisos de crear/resolver.
│   ├── sync-ui.js          # doSync, scheduleAutoSync, startBackgroundSync.
│   ├── groups.js           # Crear, unirse (invitaciones), cambiar y salir de grupos.
│   ├── diag.js             # Registro de diagnóstico (logEvent, maskUrl/maskSecret).
│   ├── update.js           # Registro del Service Worker y aviso «Versión X disponible».
│   ├── views/              # Una por pestaña: hoy, proximas, hechas, grupo, ajustes, onboarding
│   │                       # + parts.js (filas de tarea, casillas, loadCatalog).
│   ├── modals/             # todo (crear/editar tarea), catalog (tarea habitual, categoría),
│   │                       # guides (Sheets, ntfy), news (novedades).
│   ├── db.js               # Capa IndexedDB + modelo de datos + ajustes + export/import + persistencia.
│   ├── sync.js             # Sincronización bidireccional con el Web App de Apps Script.
│   ├── notify.js           # Avisos vía ntfy (POST JSON a la raíz del servidor) + cola offline.
│   ├── icons.js            # Iconos SVG (interfaz y tareas). icon(name), TASK_ICONS.
│   ├── parse.js            # «… el viernes cada 2 semanas» → {title, dueDate, repeat, …}. (puro)
│   ├── catalog.js          # Catálogo INICIAL (DEFAULT_CATALOG) + searchItems() + guessIcon(). (puro)
│   ├── dates.js            # Fechas 'YYYY-MM-DD' y nextDue() de las repeticiones. (puro, testeable en Node)
│   └── changelog.js        # APP_VERSION + array CHANGELOG. Fuente de la versión del producto.
├── icons/                  # icon.svg + PNG 192/512/180/maskable-512 (generados; ver "Iconos").
├── tools/
│   ├── test.mjs            # Pruebas unitarias y de coherencia (npm test).
│   ├── smoke.mjs           # Prueba de humo en Chrome headless (npm run smoke).
│   ├── gen_icons.py        # Genera los PNG del icono (no se publica como parte de la app).
│   └── gen_changelog.mjs   # Genera CHANGELOG.md desde js/changelog.js (npm run changelog).
├── apps-script/
│   └── Code.gs             # Código que el usuario pega en Google Apps Script (el "backend").
├── package.json            # Solo para las pruebas ("type": "module", sin dependencias).
├── ROADMAP.md              # Plan de desarrollo por fases y estado de cada paso.
├── CHANGELOG.md            # Registro de cambios GENERADO (no editar a mano).
├── CLAUDE.md               # Este archivo.
└── README.md               # Instrucciones de despliegue y configuración para el usuario final.
```

## Arquitectura y flujo de datos

- **Sin framework.** El estado vive en el objeto `state` de `state.js`. Cada cambio de datos
  re-renderiza la vista actual llamando a `refresh()` de `nav.js` (o al `renderX()` concreto).
- **Módulos y dependencias:** abajo `state.js` y `ui.js`; encima `nav.js`, `actions.js`,
  `sync-ui.js`, `groups.js`, las vistas y los modales. `nav.js` **no importa las vistas**: `app.js`
  las registra con `registerViews({hoy: renderHoy, …})`. Hay ciclos entre vistas y modales (p. ej.
  Hoy ↔ modal de tarea), que son seguros porque solo se usan funciones en tiempo de ejecución: no
  llames a funciones importadas al evaluar un módulo (en su nivel superior).
- **Variables compartidas:** un import no se puede reasignar desde otro módulo. Lo que cambie
  desde varios sitios va como propiedad de `state` (p. ej. `state.pendingInvite`).
- **Archivo nuevo** en `js/` → añádelo a `APP_SHELL` de `sw.js` (`npm test` lo comprueba).
- **Render:** cada vista construye un string HTML, lo inyecta en `#view` y luego engancha
  listeners con `$$('[data-...]').forEach(...)`. No hay virtual DOM: es simple y suficiente
  para el volumen de datos de un hogar. **Escapar siempre el texto de usuario con `esc()`**.
- **Modales:** `openModal(title, html, {onMount, wide})` / `closeModal()`. `confirmDialog()`
  devuelve una Promise<boolean>.
- **Avisos:** `toast(msg, 'ok'|'err', {action:{label, fn}})` (la acción sirve para "Deshacer").

### Pantallas

- **Sin grupos** o vista `'nuevo'` → `renderOnboarding()`: *Compartido* / *Privado* (nombre +
  tu nombre + avisos sí/no; al crear el primero compartido se ofrece crear también «Mis tareas») o *Unirme*
  (invitación + tu nombre). `body.no-group` oculta tabbar y botón de sync.
- **Selector de grupo:** el nombre de la cabecera (`#group-switch`) abre `openGroupSwitcher()`
  (lista de grupos con pendientes de hoy + crear/unirse). `switchGroup(id)` conserva la pestaña.
- **Hoy** (estilo Bring): buscador «¿Qué hay que hacer?», casillas de color con las pendientes
  (vencidas y de hoy; toque = resolver, pulsación larga/clic derecho = editar), *Recientes*
  (títulos usados que no están en el catálogo) y el **catálogo del grupo** por categorías
  (toque = añadir para hoy; si ya está pendiente sale en color; pulsación larga =
  `openItemModal`; lápiz de la categoría = `openCategoryModal`; casilla «Nueva» por categoría).
  Al añadir una tarea nueva, el toast ofrece «Guardar en categoría».
- **Próximas**: vencimiento > hoy + **repeticiones previstas** (`projectRepeats()`: hasta 28 días
  y 6 por tarea, filas `is-projected` sin check). Son solo visuales: la tarea real de la
  siguiente fecha se crea al resolver la actual. Su botón + abre el modal con `when: 'date'`.
- **Modal de tarea** (`openTodoModal`): al crear incluye «Elegir de tus tareas» (catálogo +
  recientes, chips por categoría, filtra con lo escrito) y «Guardar como tarea habitual»
  (categoría existente o nueva; se oculta si el título ya está en el catálogo).
- **Hechas** (historial + resumen semanal
  por persona), **Grupo** (miembros, invitar, Google Sheets, ntfy, salir) y **Ajustes**
  (apariencia, almacenamiento, copia de seguridad, novedades).

### Grupos y personas

- `settings.groups` = lista de grupos de este móvil y `settings.activeGroupId` el que se ve.
  Cada grupo: `{id, name, personal, currentMemberId, syncUrl, syncSecret, autoSync, lastSyncAt,
  ntfyServer, rollOver, createdAt}`. En `state.js`, **`G()`** devuelve el grupo
  activo; usa siempre `G().id` / `G().currentMemberId` (nada de campos de grupo sueltos).
  Helpers en `db.js`: `activeGroup`, `addGroup`, `updateGroup`, `removeGroup`.
- **`groupId` es LOCAL:** cada registro de `members`/`todos` lo lleva, pero no se sube a la hoja.
  Cada grupo tiene su propia Google Sheet; `syncNow(group)` sube solo los registros de ese grupo
  y asigna `groupId` a lo que descarga. Por eso dos móviles pueden tener ids de grupo distintos
  para el mismo grupo. No se permite que dos grupos usen la misma `syncUrl`.
- **Privado** (en datos `personal: true`; en la UI siempre «Privado», icono `lock`): solo tú; se
  ocultan miembros, invitar, «¿A quién le toca?» y el resumen por persona. Sheets opcional.
  El tipo se cambia en Grupo → *Tipo de grupo* (es un ajuste local de este móvil: no echa a nadie
  de la hoja, por eso se avisa si hay más miembros).
- **Avisos por persona:** cada miembro tiene su tema (`member.notify`, `ntfyTopic`, `ntfyServer`;
  ver «Notificaciones»). En Grupo, *Recibir avisos en este móvil* lo activa para tu miembro. Al
  crear un grupo compartido se elige (sí por defecto); quien se une lo tiene activado.
- **Cada móvil define su persona** en cada grupo: un registro en `members` (sincronizado) cuyo
  id se guarda en `group.currentMemberId`. `settings.myName` se propone al crear/unirse.
- **Invitación:** enlace `#join=<base64url JSON v2>` con `{groupName, syncUrl, syncSecret,
  ntfyServer}` (sin tema: cada uno tiene el suyo). Se lee en `checkInviteLink()` (al arrancar y en `hashchange`) o
  pegándolo en *Unirme* (necesario en iOS: la PWA instalada no comparte almacenamiento con
  Safari).
- Unirse **añade** un grupo (no hay que salir de los demás); si ya estás en uno con la misma
  `syncUrl` solo cambia a él (`findGroupForInvite`).
  `joinGroup` primero sincroniza y, si ya existe un miembro con el mismo nombre, lo reutiliza.
- Salir (`leaveGroup`): en compartidos marca tu miembro como borrado y sincroniza; después
  `removeGroup()` borra físicamente los registros locales del grupo (los demás los conservan).

### Almacenes IndexedDB (DB `tareas-hogar`, v4)

Definidos en `db.js` (DB v4). `DATA_STORES = ['members', 'todos', 'categories', 'items', 'routines']` se sincronizan
(y se exportan y borran con el grupo: todo lo que recorre `DATA_STORES` es genérico):

| Store     | Campos clave                                                                 |
|-----------|------------------------------------------------------------------------------|
| `members` | `id, groupId, name, color, notify, ntfyTopic, ntfyServer, updatedAt, deleted` |
| `todos`   | `id, groupId, title, icon, dueDate('YYYY-MM-DD'), repeat('none', '<N><d|w|m|y>' o '<N>w:<días>', p. ej. '2w', '1w:1,4'), repeatFrom(null|'done'), nextId, paused, pausedUntil, pausedDue, seriesDue, assignee, note, done, doneAt, doneBy, createdBy, createdAt, seriesId, updatedAt, deleted` |
| `categories` | `id, groupId, name, order, updatedAt, deleted`                            |
| `items`   | `id, groupId, name, icon, categoryId, order, updatedAt, deleted` (tareas habituales) |
| `routines` | `id, groupId, name, icon, items:[{title, icon}], order, updatedAt, deleted`  |
| `meta`    | `key, value` (`settings`, cola `ntfyQueue`)                                  |

- **Catálogo por grupo:** `db.seedCatalog(groupId)` copia `DEFAULT_CATALOG` **solo al crear** el
  grupo (o al unirse sin hoja). Quien se une con hoja lo recibe por la sincronización, así no se
  duplica. Borrar una categoría borra (soft) sus tareas habituales, no las pendientes.

- **Rutinas:** en Hoy, sección «Rutinas» (`data-routine`, mismo toque / pulsación larga que las
  casillas). `runRoutine()` (actions.js) añade para hoy las que no estén pendientes, manda **un**
  aviso y ofrece Deshacer. Editar en `modals/routine.js`. `DEFAULT_ROUTINES` (catalog.js) se crea
  con el grupo en `seedCatalog`, igual que el catálogo.

- **Borrado blando (tombstones):** eliminar = marcar `deleted:true` + `updatedAt`. La UI
  filtra con `getActive()`. Esto permite propagar los borrados por la sincronización.
- **Ocurrencia vigente:** en la UI la fecha de una tarea es `dueOf(t)` = `currentDue()` (dates.js):
  para las repetidas, la última fecha de la serie ≤ hoy (las repeticiones perdidas se agrupan; una
  diaria siempre es "de hoy"). El `dueDate` guardado no se toca; `projectRepeats()` parte de ahí.
- **Formato de `repeat`:** `'none'` o `'<N><unidad>'` (d días, w semanas, m meses, y años; `'2w'` =
  cada 2 semanas). Con semanas admite **días concretos** ISO (1 = lunes … 7 = domingo):
  `'1w:1,4'` lunes y jueves, `'2w:6'` sábados alternos. `step()` va al siguiente día marcado de la
  semana o al primero de la semana N siguiente (sin ancla: la fecha actual marca la semana).
  `alignDue()` mueve la primera fecha al siguiente día marcado (lo usan `addTodo` y el modal, que
  lo enseña en `#td-repeat-hint`). `'1w:1,…,7'` se normaliza a `'1d'`. Usa siempre los helpers de `dates.js`: `parseRepeat`, `isRepeating`,
  `normalizeRepeat`, `repeatLabel`; `REPEAT_PRESETS` son las opciones rápidas del selector y el
  resto va por «Personalizado…». `daily/weekly/monthly` se aceptan como alias.
- **Contar desde que se hace** (`repeatFrom: 'done'`, solo intervalos): la siguiente = día en que
  se resuelve + intervalo (`nextDueOnComplete`). No se agrupa (`todoDue` devuelve su fecha) ni se
  proyecta en Próximas. Usa `todoDue(t)` / `todoRepeatLabel(t)` en la UI, nunca `currentDue` o
  `repeatLabel` sueltos sobre una tarea.
- **Posponer** (`db.postponeTodo` → `postponePatch`): mueve `dueDate`; en repetidas con calendario
  guarda `seriesDue` (la repetición que representaba). `todoDue`, `nextDueOnComplete` y
  `projectRepeats` parten de `seriesBase(t)` = `seriesDue || dueDate`, así la serie no se desplaza.
  La siguiente repetición y la pausa limpian `seriesDue`.
- **«Pasan a hoy»** (`group.rollOver`, local, apagado): `dueOf()` de `state.js` devuelve hoy para
  las no repetidas atrasadas; la fila muestra «Desde …». No cambia datos.
- **Pausa** (`db.pauseTodo/resumeTodo`, vacaciones `pauseGroupRepeats/resumeGroupRepeats`):
  con fecha = mover `dueDate` a `resumeDue(t, until)` (primera de la serie ≥ esa fecha) +
  `pausedUntil` (etiqueta) + `pausedDue` (fecha original, para «Reanudar ya»). Sin fecha =
  `paused: true`: se excluye de Hoy, de la cuenta del selector de grupos y de Próximas (sección
  «En pausa» con botón `data-resume`). Cualquier filtro nuevo de pendientes debe excluir
  `t.paused`. Las que no se repiten no se pausan. La siguiente repetición limpia los campos.
- **`nextId`:** `completeTodo` guarda en la resuelta el id de la repetición que crea; `reopenTodo`
  borra esa (si nadie la ha tocado), sea cual sea el modo y el día en que se deshaga.
- **Repeticiones:** `completeTodo()` marca hecha y crea la siguiente con id determinista
  `${seriesId}@${dueDate}` (si los dos móviles la resuelven a la vez no se duplica).
  `reopenTodo()` borra esa siguiente si sigue sin tocar. `nextDue()` salta los días perdidos.

### Sincronización (opcional)

- Backend = **Google Apps Script Web App** ligado a una Google Sheet (`apps-script/Code.gs`).
- Estrategia **last-write-wins por registro** usando `updatedAt`.
- **Protocolo v2 (Code.gs `SCRIPT_VERSION = 2`, `REQUIRED_SCRIPT_VERSION` en sync.js):** una sola
  petición `POST action=sync {since, records}`. La app envía lo cambiado desde `group.pushedAt`
  (reloj local, se guarda la hora de inicio) y `since = group.syncRev`. El script guarda lo más
  nuevo, numera cada cambio (`rev`, columna F, contador en ScriptProperties) y devuelve lo
  cambiado desde `since` sin lo que acaba de recibir. `rev` nunca es 0.
- **full:** si `since` es 0 o anterior a `purgeRev` (hubo archivo desde entonces), la respuesta es
  completa y `reconcile()` borra en local lo que no está (salvo lo enviado o cambiado durante la
  petición). Sin `syncRev` se envía todo; cambiar la URL de la hoja resetea `syncRev/pushedAt`.
- **Compatibilidad:** si el script responde `accion desconocida` (v1), `legacySync()` hace el
  pull + push de siempre y `scriptVersion = 1` (Grupo avisa con `.warn-box` y la guía de
  actualizar). El script v2 sigue aceptando `pull`/`push` de apps antiguas (les asigna `rev`).
  Grupo guarda `scriptVersion`, `syncRev`, `pushedAt`, `summaryInstalled` (de cada respuesta).
- **Archivo:** como mucho una vez al día (`purgeIfDue_`), las tareas hechas hace más de
  `KEEP_DONE_DAYS` (90) y los borrados de más de `KEEP_DELETED_DAYS` (60) pasan a la pestaña
  `archivo`. `db.purgeOld()` hace lo mismo en local al arrancar (también sin hoja). Los plazos
  están en `db.js` y en `Code.gs`: `npm test` comprueba que coinciden.
- **CORS / gotcha importante:** GET con querystring y POST con `Content-Type: text/plain`
  (petición "simple", sin preflight OPTIONS, que Apps Script no gestiona bien). **No añadir
  cabeceras personalizadas** (el token va en el body/querystring, no en `Authorization`).
- Auto-sync: tras cada cambio se llama a `scheduleAutoSync()` (debounce 1,5 s) si hay URL y
  `autoSync` activo. La cabecera tiene botón de sync manual (`#btn-sync`).
- El Web App debe desplegarse con acceso **"Cualquier persona"**; los responses incluyen
  `Access-Control-Allow-Origin: *`, por eso funciona desde el navegador.
- Además del auto-sync tras cambios, `startBackgroundSync()` sincroniza **todos los grupos** al
  arrancar, en `visibilitychange`, en `online` y cada `POLL_MS` (60 s) con la app visible.
  `doSync(silent, groupId)` no se solapa por grupo (mapa `syncing`), solo repinta si llegó algo
  al grupo activo
  (y nunca con un modal abierto o mientras se escribe en un input de la vista).
- `Code.gs` es genérico (filas `store, id, updatedAt, deleted, json, rev`): no conoce los
  almacenes salvo `todos`/`members` para el archivo y el resumen.
- **Resumen diario (Code.gs):** `instalarResumenDiario()` (el usuario lo ejecuta una vez; también
  sirve para autorizar el script) crea un activador horario → `resumenDiario()` envía a cada
  miembro con `summaryHour` (+ `tz`, `ntfyTopic`, `ntfyServer`, `summaryTitle`, `summaryClick`,
  que guarda la app en Grupo → Avisos) un aviso a su hora, una vez al día
  (`summary:<id>` en ScriptProperties) y solo si hay algo (`buildSummary_`).
  `enviarResumenAhora()` lo manda sin mirar la hora. Las fechas son una **copia de dates.js**
  (`todoDue_` y compañía): si cambias la lógica de repeticiones, cámbiala en los dos sitios
  (`npm test` las compara en miles de casos).
- Cambiar los servicios que usa `Code.gs` obliga a **volver a autorizar** (ejecutar una función) y
  a publicar una versión nueva; si no, Google responde 403.

### Notificaciones (ntfy)

- `notify.js` publica con `POST <servidor>/` y cuerpo JSON `{topic, title, message, tags, click}`
  **sin cabeceras** (petición simple, sin preflight; los acentos van en el body, no en cabeceras).
- **Un tema por persona:** cada miembro guarda `notify`, `ntfyTopic` (y opcional `ntfyServer`;
  si no, el `ntfyServer` del grupo). Se sincroniza con los miembros, así cada móvil sabe dónde
  avisar a los demás. `recipientsOf(group, members, exceptId)` = los demás que reciben avisos;
  `notify(group, recipients, n)` publica en el tema de cada uno. **Nadie recibe sus propios avisos**
  y en un grupo privado no hay destinatarios (no hay avisos de crear/resolver).
- Se avisa al **añadir** una tarea, al **resolverla** y al lanzar una **rutina** (un solo aviso)
  (`notifyOthers` en actions.js); editar, borrar, deshacer y las repeticiones generadas no avisan.
- **Asignar:** al añadir con «¿A quién le toca?» = otra persona, esa recibe solo «X te ha asignado
  «…» para …» y el resto el aviso normal (`splitAssignee`). Al editar y cambiar la persona
  (`notifyAssigned`), solo ella. Asignarse a uno mismo no genera aviso de asignación.
  Título = nombre del grupo. La cola guarda servidor y tema de cada mensaje (`flushQueue()` global).
- Tema: `memberTopic(grupo, nombre)` = `randomTopic(...)` → p. ej. `tareas-hogar-juan-k3j9x2m1qa`
  (`[-_A-Za-z0-9]{1,64}`). Se genera al crear/unirse aunque los avisos estén apagados.
- **Suscribirse:** `subscribeLink(server, topic, display)` → `ntfy://host/tema?display=…`
  (`secure=false` si el servidor es http); la app ntfy de Android se suscribe sola. «Probar» envía
  a tu propio tema.
- Sin red → cola en `meta.ntfyQueue` (máx. 50, caducan a las 24 h); `flushQueue()` en cada tick.

### Escribir con naturalidad (`parse.js`)

- `parseTask(text, {today, members, ignore})` → `{title, dueDate, repeat, repeatFrom, assignee,
  assigneeName, found}`. Reglas por prioridad sobre el texto sin tildes (`fold`, misma longitud que
  el original para recortar el título): primero repeticiones («los lunes» no es «el lunes»), luego
  «desde que se haga», fechas y «para Ana»/«le toca a Ana» (solo miembros). «cada 2 semanas» + «los
  sábados» se combinan en `'2w:6'`. Las palabras de enlace sueltas se quitan del título.
- **Hoy:** el buscador busca y crea con `title` limpio; `addForToday` aplica lo entendido de
  `state.search`. Los chips (`parseChips`, `data-ignore`) descartan un tipo
  (`state.parseIgnore`, se vacía al añadir o borrar el texto).
- **Modal de tarea nueva:** chips + «Aplicar» (`#td-parse-apply`) que rellena el formulario; nunca
  lo cambia sin pedirlo.
- Frases nuevas → añade su caso en `describe('parse.js')` de `tools/test.mjs`.

### Diagnóstico

- `diag.js`: `logEvent({kind, level, group, message, detail})` guarda en `meta.diagLog` los últimos
  100 eventos (`kind`: `sync`, `ntfy`, `js`, `sw`). Si un evento repite el anterior (mismo tipo,
  grupo y mensaje) solo suma `count`, así la sincronización de cada minuto no llena el registro.
  Nunca lanza; las escrituras se encadenan.
- `sync.js` lanza `SyncError` con `detail` (paso, URL enmascarada, HTTP, `cors`, trozo de la
  respuesta sin HTML, ms). **Nunca** guardes URLs con querystring (llevan el token): usa
  `maskUrl()`; los temas y claves, con `maskSecret()`.
- Se registra: errores de `doSync` y de «Probar», avisos que se quedan en cola o no se reenvían,
  errores de JS no capturados (`installGlobalHandlers()` en `init`) y fallos del Service Worker.
- `state.syncErrors[groupId]` → punto rojo en `#btn-sync` (`updateSyncBadge()`, también en
  `applyShell`). Los toasts de error ofrecen «Detalles» → `openDiagModal()` (`modals/diag.js`).
- El modal muestra entorno, estado por grupo (falla si el último error es posterior a
  `lastSyncAt`), eventos e informe de texto (`#diag-report`) para copiar.

## Versionado y changelog

- **Fuente única de versión:** `APP_VERSION` en `js/changelog.js` (SemVer).
- Al publicar cambios:
  1. Sube `APP_VERSION` y añade una entrada arriba en `CHANGELOG` (tipos: `add`/`chg`/`fix`).
  2. **Actualiza `CACHE_VERSION` en `sw.js`** al mismo número (`v` + versión) para forzar la
     actualización de la caché en los dispositivos. Si te olvidas, los usuarios verán la
     versión antigua cacheada.
  3. Regenera el changelog del repo: `npm run changelog` (→ `CHANGELOG.md`).
  4. Pasa `npm test` y `npm run smoke` (comprueban, entre otras cosas, los pasos 1–3).
- La versión se muestra en la cabecera (botón → `openChangelogModal()`) y en Ajustes →
  Acerca de → "Novedades".
- **Novedades tras actualizar:** `showWhatsNewIfUpdated()` compara `APP_VERSION` con
  `settings.lastSeenVersion` (`compareVersions()` de `changelog.js`) y abre el modal con las
  entradas posteriores destacadas. En una instalación nueva solo guarda la versión.
- Escribe las entradas del `CHANGELOG` pensando en el usuario final (se le muestran tal cual).

## Cómo ejecutar / probar en local

Los ES modules y el Service Worker **necesitan http(s)** (no abrir con `file://`):

```bash
cd Tareas
python3 -m http.server 8765
# abrir http://localhost:8765
```

### Pruebas (antes de dar por bueno cualquier cambio)

- **`npm test`** (`tools/test.mjs`, `node:test`, ~0,1 s): fechas y repeticiones, catálogo,
  versión (`APP_VERSION` = primera entrada del changelog = `CACHE_VERSION`, `CHANGELOG.md`
  regenerado), que existan todos los iconos usados, que **todo módulo importado desde
  `js/app.js` (y cada `fetch('ruta')` relativo) esté en `APP_SHELL`** y que no sobre ningún módulo.
- **`tools/gas-sim.mjs`:** ejecuta el `Code.gs` **real** en Node (vm) con imitaciones de
  SpreadsheetApp, PropertiesService, UrlFetchApp, ScriptApp… Lo usan las dos pruebas.
  `tools/fixtures/Code.v1.gs` es la versión 1 (para probar la compatibilidad).
- **`npm run smoke`** (`tools/smoke.mjs`, ~5 s): levanta un servidor estático (con la caché de
  10 min de GitHub Pages), el **Web App simulado** (Code.gs real; `/macros/s/v1/` = script v1,
  `/macros/s/denegado/` = 403), un **ntfy simulado** y Chrome headless (`CHROME=` para otra
  ruta, `SMOKE_SHOW=1` para verlo). Dos "móviles" = dos contextos aislados. Recorre arranque,
  crear grupo, añadir/resolver, repetida en Próximas, pestañas, Service Worker **sin conexión**
  (vacía la caché HTTP y apaga el servidor) y sincronización A↔B. Bloquea `ntfy.sh`.
  Si falla, deja capturas en una carpeta temporal (la ruta sale en el mensaje).
- Al añadir una funcionalidad, añade su caso a `smoke.mjs` y la lógica pura a `test.mjs`.
- `package.json` (`"type": "module"`) permite importar `js/*.js` directamente en Node; para
  comprobar la sintaxis basta `node --check js/archivo.js`.
- `checkSyncUrl()` acepta `localhost`/`127.0.0.1` para poder usar el simulador.

## Despliegue (GitHub Pages)

Repo con estos archivos en la raíz → Settings → Pages → Deploy from branch (`main`, `/root`).
`.nojekyll` evita el procesado de Jekyll. Las rutas son **relativas** (`./`) y el `scope`
del manifest/SW también, así funciona bajo `usuario.github.io/repo/`.

## Iconos

`icons/icon.svg` es la fuente vectorial. Diseño = cuadrado azul (degradado #5a97ff→#3f7ae6)
con una **casa** blanca (tejado en chevron, chimenea, cuerpo con la puerta hueca). Los PNG se
generan con `python3 tools/gen_icons.py icons` (stdlib, sin PIL), que dibuja la misma geometría con SDF y
antialiasing: 192/512 con esquinas redondeadas, 180 (Apple) y maskable-512 a sangre (la
maskable con la casa al 80 % para respetar la zona segura). Si cambias el diseño, cambia
ambos (SVG y script) y regenera los cuatro PNG.

**Iconos de la interfaz:** `js/icons.js`, trazo 24×24 estilo "outline", `stroke="currentColor"`.
Para añadir uno, mete su `<path>` en `PATHS`; si es de tarea, añádelo también a `TASK_ICONS`
(y, si procede, úsalo en `DEFAULT_CATALOG` de `catalog.js`).
En el HTML estático se usan con `data-icon="nombre"` (se rellenan en `init()`). Los `<option>`
de los `<select>` no admiten SVG: ahí va solo el texto.

## Convenciones

- Idioma de la UI y comentarios: **español** (con acentos correctos).
- Sin dependencias externas ni CDNs (todo self-contained para offline y privacidad).
- Nada de emojis en la UI: usa `icon()` (los tags de ntfy sí son emojis, pero salen en la app ntfy).
- `crypto.randomUUID()` para ids. Fechas con `Intl.DateTimeFormat('es-ES', ...)`.
- CSS usa `color-mix()` y variables CSS (target: navegadores modernos 2023+).

## Gotchas / cosas a vigilar

- **Fase de desarrollo:** un único usuario; **no** se mantiene compatibilidad entre versiones (sin
  migraciones). Si un cambio rompe los datos locales, basta con borrar los datos del sitio.

- **`CACHE_VERSION` (sw.js) ↔ `APP_VERSION` (changelog.js)**: mantener sincronizados.
- **Service Worker = cache-first estricto por versión:** precarga con `cache: 'reload'` (salta la
  caché HTTP de 10 min de GitHub Pages) y no refresca archivos sueltos; así nunca mezcla un
  `app.js` nuevo con módulos viejos (eso dejaba la app en «v0.0.0» sin arrancar). Todo archivo
  nuevo del shell debe ir en `APP_SHELL`. Se registra con `updateViaCache: 'none'`.
- **Aviso de versión nueva** (`update.js`): `registerServiceWorker()` registra el SW y, si ya
  había uno controlando la página, en `controllerchange` muestra un toast fijo
  «Versión X disponible · Recargar» (X sale del `changelog.js` nuevo). No recarga sola. Al volver
  a la app (`visibilitychange`) llama a `reg.update()` como mucho cada 30 min.
  `toast(…, {persist: true})` = toast que no desaparece solo.
- **Arranque de seguridad** (script inline al final de `index.html`): si `window.__tareasBooted`
  (lo pone `init()` tras pintar) no está a los 5 s, muestra el error y «Reparar y recargar»
  (borra SW y cachés, no IndexedDB).
- No mandar cabeceras extra en el `fetch` de sync (rompería con preflight en Apps Script).
- Los borrados son blandos: nunca hagas `delete` físico si el registro debe sincronizarse.
- El export **no** incluye `syncUrl`/`syncSecret` de ningún grupo (por seguridad). Los temas de
  ntfy van en los miembros (sí se exportan): trata la copia como privada.
  Al importar, los registros de grupos que no existen en el móvil van al grupo activo.
- La invitación lleva la URL del Web App y la clave: tratarla como una contraseña.
- La guía de Sheets (`modals/guides.js`) muestra `apps-script/Code.gs` con `fetch`: no hay copias
  del script en el JS. `Code.gs` está en `APP_SHELL` para que la guía funcione sin conexión.
