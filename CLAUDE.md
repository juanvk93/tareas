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
│   ├── app.js              # Entrada. Router, vistas, modales, toasts, tema, wiring. (el archivo grande)
│   ├── db.js               # Capa IndexedDB + modelo de datos + ajustes + export/import + persistencia.
│   ├── sync.js             # Sincronización bidireccional con el Web App de Apps Script.
│   ├── notify.js           # Avisos vía ntfy (POST JSON a la raíz del servidor) + cola offline.
│   ├── icons.js            # Iconos SVG (interfaz y tareas). icon(name), TASK_ICONS.
│   ├── catalog.js          # Catálogo INICIAL (DEFAULT_CATALOG) + searchItems() + guessIcon(). (puro)
│   ├── dates.js            # Fechas 'YYYY-MM-DD' y nextDue() de las repeticiones. (puro, testeable en Node)
│   └── changelog.js        # APP_VERSION + array CHANGELOG. Fuente de la versión del producto.
├── icons/                  # icon.svg + PNG 192/512/180/maskable-512 (generados; ver "Iconos").
├── tools/
│   ├── gen_icons.py        # Genera los PNG del icono (no se publica como parte de la app).
│   └── gen_changelog.mjs   # Genera CHANGELOG.md desde js/changelog.js.
├── apps-script/
│   └── Code.gs             # Código que el usuario pega en Google Apps Script (el "backend").
├── CHANGELOG.md            # Registro de cambios GENERADO (no editar a mano).
├── CLAUDE.md               # Este archivo.
└── README.md               # Instrucciones de despliegue y configuración para el usuario final.
```

## Arquitectura y flujo de datos

- **Sin framework.** El estado vive en el objeto `state` de `app.js`. Cada cambio de datos
  re-renderiza la vista actual llamando a `refresh()` (o al `renderX()` concreto).
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
  notifyEnabled, ntfyServer, ntfyTopic, createdAt}`. En `app.js`, **`G()`** devuelve el grupo
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
- **Avisos por grupo:** interruptor *Enviar avisos* en Grupo (`notifyEnabled`). Apagado oculta la
  config de ntfy; al encenderlo se genera tema si no hay. Al crear el grupo se elige (por defecto
  sí en compartidos, no en privados). El tema se genera siempre al crear.
- **Cada móvil define su persona** en cada grupo: un registro en `members` (sincronizado) cuyo
  id se guarda en `group.currentMemberId`. `settings.myName` se propone al crear/unirse.
- **Invitación:** enlace `#join=<base64url JSON v2>` con `{groupName, syncUrl, syncSecret,
  ntfyServer, ntfyTopic}`. Se lee en `checkInviteLink()` (al arrancar y en `hashchange`) o
  pegándolo en *Unirme* (necesario en iOS: la PWA instalada no comparte almacenamiento con
  Safari).
- Unirse **añade** un grupo (no hay que salir de los demás); si ya estás en uno con la misma
  `syncUrl` (o el mismo tema, si no hay hoja) solo cambia a él (`findGroupForInvite`).
  `joinGroup` primero sincroniza y, si ya existe un miembro con el mismo nombre, lo reutiliza.
- Salir (`leaveGroup`): en compartidos marca tu miembro como borrado y sincroniza; después
  `removeGroup()` borra físicamente los registros locales del grupo (los demás los conservan).

### Almacenes IndexedDB (DB `tareas-hogar`, v2)

Definidos en `db.js` (DB v3). `DATA_STORES = ['members', 'todos', 'categories', 'items']` se sincronizan:

| Store     | Campos clave                                                                 |
|-----------|------------------------------------------------------------------------------|
| `members` | `id, groupId, name, color, updatedAt, deleted`                               |
| `todos`   | `id, groupId, title, icon, dueDate('YYYY-MM-DD'), repeat(none/daily/weekly/monthly), assignee, note, done, doneAt, doneBy, createdBy, createdAt, seriesId, updatedAt, deleted` |
| `categories` | `id, groupId, name, order, updatedAt, deleted`                            |
| `items`   | `id, groupId, name, icon, categoryId, order, updatedAt, deleted` (tareas habituales) |
| `meta`    | `key, value` (`settings`, cola `ntfyQueue`)                                  |

- **Catálogo por grupo:** `db.seedCatalog(groupId)` copia `DEFAULT_CATALOG` **solo al crear** el
  grupo (o al unirse sin hoja). Quien se une con hoja lo recibe por la sincronización, así no se
  duplica. Borrar una categoría borra (soft) sus tareas habituales, no las pendientes.

- **Borrado blando (tombstones):** eliminar = marcar `deleted:true` + `updatedAt`. La UI
  filtra con `getActive()`. Esto permite propagar los borrados por la sincronización.
- **Ocurrencia vigente:** en la UI la fecha de una tarea es `dueOf(t)` = `currentDue()` (dates.js):
  para las repetidas, la última fecha de la serie ≤ hoy (las repeticiones perdidas se agrupan; una
  diaria siempre es "de hoy"). El `dueDate` guardado no se toca; `projectRepeats()` parte de ahí.
- **Repeticiones:** `completeTodo()` marca hecha y crea la siguiente con id determinista
  `${seriesId}@${dueDate}` (si los dos móviles la resuelven a la vez no se duplica).
  `reopenTodo()` borra esa siguiente si sigue sin tocar. `nextDue()` salta los días perdidos.

### Sincronización (opcional)

- Backend = **Google Apps Script Web App** ligado a una Google Sheet (`apps-script/Code.gs`).
- Estrategia **last-write-wins por registro** usando `updatedAt`. `syncNow()`:
  1. `pull` (GET) todos los registros remotos → aplica los más nuevos en local.
  2. `push` (POST) todo el estado local → el servidor conserva el más nuevo por `id`.
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
- `Code.gs` es genérico (filas `store, id, updatedAt, deleted, json`): no cambió en la v2.

### Notificaciones (ntfy)

- `notify.js` publica con `POST <servidor>/` y cuerpo JSON `{topic, title, message, tags, click}`
  **sin cabeceras** (petición simple, sin preflight; los acentos van en el body, no en cabeceras).
- `notify(group, n)` usa la config del grupo; cada grupo tiene su tema. Se avisa al **añadir**
  una tarea y al **resolverla** (`notifyCreated`/`notifyResolved`); editar, borrar, deshacer y
  las repeticiones generadas no avisan. Autor = `G().currentMemberId`; título = nombre del grupo.
  La cola guarda el servidor de cada mensaje, así `flushQueue()` sirve para todos los grupos.
- Todos los móviles se suscriben al mismo tema, así que quien añade la tarea también recibe el aviso.
- Sin red → cola en `meta.ntfyQueue` (máx. 50, caducan a las 24 h); `flushQueue()` en cada tick.
- Por grupo: `notifyEnabled`, `ntfyServer` (def. `https://ntfy.sh`), `ntfyTopic` (`[-_A-Za-z0-9]{1,64}`).
  Al crear el grupo se genera `randomTopic(name)` → p. ej. `tareas-hogar-k3j9x2m1qa`.

## Versionado y changelog

- **Fuente única de versión:** `APP_VERSION` en `js/changelog.js` (SemVer).
- Al publicar cambios:
  1. Sube `APP_VERSION` y añade una entrada arriba en `CHANGELOG` (tipos: `add`/`chg`/`fix`).
  2. **Actualiza `CACHE_VERSION` en `sw.js`** al mismo número (`v` + versión) para forzar la
     actualización de la caché en los dispositivos. Si te olvidas, los usuarios verán la
     versión antigua cacheada.
  3. Regenera el changelog del repo: `node tools/gen_changelog.mjs` (→ `CHANGELOG.md`).
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

- Comprobar sintaxis de módulos: copiar a `.mjs` y `node --check` (los `.js` sueltos dan
  falso error de "import outside module" en Node porque los trata como CommonJS).
- `dates.js` y `catalog.js` son JS puro (sin DOM): se pueden importar en Node (copiados a `.mjs`).
- Para probar la sincronización sin Google se puede levantar un mock del Web App (servidor HTTP
  que responde `{ok, records}` a GET y hace upsert LWW en POST, con `Access-Control-Allow-Origin: *`).

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
- No mandar cabeceras extra en el `fetch` de sync (rompería con preflight en Apps Script).
- Los borrados son blandos: nunca hagas `delete` físico si el registro debe sincronizarse.
- El export **no** incluye `syncUrl`/`syncSecret`/`ntfyTopic` de ningún grupo (por seguridad).
  Al importar, los registros de grupos que no existen en el móvil van al grupo activo.
- La invitación lleva la URL del Web App y la clave: tratarla como una contraseña.
- `APPS_SCRIPT_CODE` en `app.js` es una copia de `apps-script/Code.gs`: si tocas uno, toca el otro.
