# CLAUDE.md — Tareas del Hogar

Guía para trabajar en este proyecto en futuras sesiones. Léela antes de tocar código.

## Qué es

PWA (Progressive Web App) **sin backend propio ni build step**: HTML + CSS + JavaScript
vanilla (ES modules) pensada para publicarse tal cual en **GitHub Pages**. Sirve para
que una pareja o familia comparta una **lista de tareas pendientes** (del hogar y otras), al
estilo de la app de lista de la compra *Bring*: un **grupo** con sus miembros, tareas para hoy
o planificadas para otro día (con repetición) y cualquiera puede marcarlas como resueltas.

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
│   ├── catalog.js          # Catálogo de tareas habituales por categoría + búsqueda + guessIcon(). (puro)
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

- **Sin grupo** (`settings.groupName` vacío) → `renderOnboarding()`: *Crear grupo* (nombre +
  tu nombre) o *Unirme* (invitación + tu nombre). `body.no-group` oculta tabbar y botón de sync.
- **Hoy** (estilo Bring): buscador «¿Qué hay que hacer?», casillas de color con las pendientes
  (vencidas y de hoy; toque = resolver, pulsación larga/clic derecho = editar), *Recientes* y
  el catálogo por categorías (toque = añadir para hoy; si ya está pendiente sale en color).
- **Próximas** (vencimiento > hoy, agrupadas por día), **Hechas** (historial + resumen semanal
  por persona), **Grupo** (miembros, invitar, Google Sheets, ntfy, salir) y **Ajustes**
  (apariencia, almacenamiento, copia de seguridad, novedades).

### Grupo y personas

- El grupo vive en los ajustes locales de cada móvil: `groupName`, `syncUrl`, `syncSecret`,
  `ntfyServer`, `ntfyTopic`, `notifyEnabled`. **Cada móvil define su persona**: un registro en
  `members` (sincronizado) cuyo id se guarda en `settings.currentMemberId`.
- **Invitación:** enlace `#join=<base64url JSON v2>` con `{groupName, syncUrl, syncSecret,
  ntfyServer, ntfyTopic}`. Se lee en `checkInviteLink()` (al arrancar y en `hashchange`) o
  pegándolo en *Unirme* (necesario en iOS: la PWA instalada no comparte almacenamiento con
  Safari). También acepta el `#setup=` (v1) de la 1.1.
- Al unirse (`joinGroup`) primero se sincroniza y, si ya existe un miembro con el mismo nombre,
  se reutiliza (reinstalar no duplica personas). Salir (`leaveGroup`) marca tu miembro como
  borrado, sincroniza y vacía los stores de datos y la config del grupo.

### Almacenes IndexedDB (DB `tareas-hogar`, v2)

Definidos en `db.js`. `DATA_STORES = ['members', 'todos']` son los que se sincronizan:

| Store     | Campos clave                                                                 |
|-----------|------------------------------------------------------------------------------|
| `members` | `id, name, color, updatedAt, deleted`                                        |
| `todos`   | `id, title, icon, dueDate('YYYY-MM-DD'), repeat(none/daily/weekly/monthly), assignee, note, done, doneAt, doneBy, createdBy, createdAt, seriesId, updatedAt, deleted` |
| `meta`    | `key, value` (`settings`, cola `ntfyQueue`)                                  |

- `tasks`/`log`/`schedule` son de la v1.x: se crean/conservan en el upgrade pero no se usan.
- **Borrado blando (tombstones):** eliminar = marcar `deleted:true` + `updatedAt`. La UI
  filtra con `getActive()`. Esto permite propagar los borrados por la sincronización.
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
- Además del auto-sync tras cambios, `startBackgroundSync()` sincroniza al arrancar, en
  `visibilitychange` (al volver a la app), en `online` y cada `POLL_MS` (60 s) con la app visible.
  `doSync()` no se solapa (promesa `syncing`) y en modo silencioso solo repinta si llegó algo
  (y nunca con un modal abierto o mientras se escribe en un input de la vista).
- `Code.gs` es genérico (filas `store, id, updatedAt, deleted, json`): no cambió en la v2.

### Notificaciones (ntfy)

- `notify.js` publica con `POST <servidor>/` y cuerpo JSON `{topic, title, message, tags, click}`
  **sin cabeceras** (petición simple, sin preflight; los acentos van en el body, no en cabeceras).
- Se avisa al **añadir** una tarea y al **resolverla** (`notifyCreated`/`notifyResolved` en
  `app.js`); editar, borrar, deshacer y las repeticiones generadas no avisan. El autor es
  `settings.currentMemberId`; el título del aviso, `groupName`.
- Todos los móviles se suscriben al mismo tema, así que quien añade la tarea también recibe el aviso.
- Sin red → cola en `meta.ntfyQueue` (máx. 50, caducan a las 24 h); `flushQueue()` en cada tick.
- Ajustes: `notifyEnabled`, `ntfyServer` (def. `https://ntfy.sh`), `ntfyTopic` (`[-_A-Za-z0-9]{1,64}`).
  Al crear el grupo se genera `randomTopic(groupName)` → p. ej. `tareas-hogar-k3j9x2m1qa`.

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
(y, si procede, úsalo en `catalog.js`).
En el HTML estático se usan con `data-icon="nombre"` (se rellenan en `init()`). Los `<option>`
de los `<select>` no admiten SVG: ahí va solo el texto.

## Convenciones

- Idioma de la UI y comentarios: **español** (con acentos correctos).
- Sin dependencias externas ni CDNs (todo self-contained para offline y privacidad).
- Nada de emojis en la UI: usa `icon()` (los tags de ntfy sí son emojis, pero salen en la app ntfy).
- `crypto.randomUUID()` para ids. Fechas con `Intl.DateTimeFormat('es-ES', ...)`.
- CSS usa `color-mix()` y variables CSS (target: navegadores modernos 2023+).

## Gotchas / cosas a vigilar

- **`CACHE_VERSION` (sw.js) ↔ `APP_VERSION` (changelog.js)**: mantener sincronizados.
- No mandar cabeceras extra en el `fetch` de sync (rompería con preflight en Apps Script).
- Los borrados son blandos: nunca hagas `delete` físico si el registro debe sincronizarse.
- El export **no** incluye `syncUrl`/`syncSecret`/`ntfyTopic` (por seguridad); se recuperan con
  la invitación del grupo.
- La invitación lleva la URL del Web App y la clave: tratarla como una contraseña.
- `APPS_SCRIPT_CODE` en `app.js` es una copia de `apps-script/Code.gs`: si tocas uno, toca el otro.
