# CLAUDE.md — Tareas del Hogar

Guía para trabajar en este proyecto en futuras sesiones. Léela antes de tocar código.

## Qué es

PWA (Progressive Web App) **sin backend propio ni build step**: HTML + CSS + JavaScript
vanilla (ES modules) pensada para publicarse tal cual en **GitHub Pages**. Sirve para
que una pareja o familia controle las tareas del hogar: crear tareas, repartirlas por
la semana, apuntar quién hace qué y ver estadísticas.

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
│   ├── icons.js            # Iconos SVG (interfaz y tareas). icon(name), taskIcon(task), TASK_ICONS.
│   ├── stats.js            # Cálculos puros de estadísticas y segmentos del donut. (sin DOM: testeable en Node)
│   └── changelog.js        # APP_VERSION + array CHANGELOG. Fuente de la versión del producto.
├── icons/                  # icon.svg + PNG 192/512/180/maskable-512 (generados; ver "Iconos").
├── tools/
│   └── gen_icons.py        # Genera los PNG del icono (no se publica como parte de la app).
├── apps-script/
│   └── Code.gs             # Código que el usuario pega en Google Apps Script (el "backend").
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
- **Avisos:** `toast(msg, 'ok'|'err')`.

### Almacenes IndexedDB (DB `tareas-hogar`, v1)

Definidos en `db.js`. Todos los registros de datos comparten forma con metadatos de sync:

| Store      | Campos clave                                                    |
|------------|-----------------------------------------------------------------|
| `members`  | `id, name, color, emoji, updatedAt, deleted`                    |
| `tasks`    | `id, name, icon, points, updatedAt, deleted` (v1.0.0: `emoji`)  |
| `log`      | `id, taskId, memberId, ts, points, note, updatedAt, deleted`    |
| `schedule` | `id, weekKey, day(0=Lun..6=Dom), taskId, memberId, updatedAt, deleted` |
| `meta`     | `key, value` (`settings`, flag `seeded`, cola `ntfyQueue`)      |

- **Borrado blando (tombstones):** eliminar = marcar `deleted:true` + `updatedAt`. La UI
  filtra con `getActive()`. Esto permite propagar los borrados por la sincronización.
- `weekKey` es la fecha (YYYY-MM-DD) del **lunes** de esa semana (`ymd(startOfWeek(...))`).
- Los **puntos** de cada tarea representan el esfuerzo; las estadísticas usan conteo y puntos.

### Sincronización (opcional)

- Backend = **Google Apps Script Web App** ligado a una Google Sheet (`apps-script/Code.gs`).
- Estrategia **last-write-wins por registro** usando `updatedAt`. `syncNow()`:
  1. `pull` (GET) todos los registros remotos → aplica los más nuevos en local.
  2. `push` (POST) todo el estado local → el servidor conserva el más nuevo por `id`.
- **CORS / gotcha importante:** GET con querystring y POST con `Content-Type: text/plain`
  (petición "simple", sin preflight OPTIONS, que Apps Script no gestiona bien). **No añadir
  cabeceras personalizadas** (el token va en el body/querystring, no en `Authorization`).
- Auto-sync: tras cada cambio se llama a `scheduleAutoSync()` (debounce 2,5 s) si hay URL y
  `autoSync` activo. La cabecera tiene botón de sync manual (`#btn-sync`).
- El Web App debe desplegarse con acceso **"Cualquier persona"**; los responses incluyen
  `Access-Control-Allow-Origin: *`, por eso funciona desde el navegador.
- Además del auto-sync tras cambios, `startBackgroundSync()` sincroniza al arrancar, en
  `visibilitychange` (al volver a la app), en `online` y cada `POLL_MS` (60 s) con la app visible.
  `doSync()` no se solapa (promesa `syncing`) y en modo silencioso solo repinta si llegó algo.

### Notificaciones (ntfy)

- `notify.js` publica con `POST <servidor>/` y cuerpo JSON `{topic, title, message, tags, click}`
  **sin cabeceras** (petición simple, sin preflight; los acentos van en el body, no en cabeceras).
- Se avisa al **crear tarea** (catálogo), **asignar en la semana** y **completar** (`notifyTask*`
  en `app.js`). Deshacer/borrar no avisa. El autor de "crear" es `settings.currentMemberId`.
- Todos los móviles se suscriben al mismo tema, así que quien crea la tarea también recibe el aviso.
- Sin red → cola en `meta.ntfyQueue` (máx. 50, caducan a las 24 h); `flushQueue()` en cada tick.
- Ajustes: `notifyEnabled`, `ntfyServer` (def. `https://ntfy.sh`), `ntfyTopic` (`[-_A-Za-z0-9]{1,64}`).
- **Compartir configuración:** enlace `#setup=<base64url JSON>` con syncUrl/secret/ntfy. Se lee en
  `checkSetupLink()` al arrancar o pegándolo en Ajustes (necesario en iOS: la PWA instalada no
  comparte almacenamiento con Safari).

## Versionado y changelog

- **Fuente única de versión:** `APP_VERSION` en `js/changelog.js` (SemVer).
- Al publicar cambios:
  1. Sube `APP_VERSION` y añade una entrada arriba en `CHANGELOG` (tipos: `add`/`chg`/`fix`).
  2. **Actualiza `CACHE_VERSION` en `sw.js`** al mismo número (`v` + versión) para forzar la
     actualización de la caché en los dispositivos. Si te olvidas, los usuarios verán la
     versión antigua cacheada.
- La versión se muestra en la cabecera y en Ajustes → Acerca de → "Novedades" (modal).

## Cómo ejecutar / probar en local

Los ES modules y el Service Worker **necesitan http(s)** (no abrir con `file://`):

```bash
cd Tareas
python3 -m http.server 8765
# abrir http://localhost:8765
```

- Comprobar sintaxis de módulos: copiar a `.mjs` y `node --check` (los `.js` sueltos dan
  falso error de "import outside module" en Node porque los trata como CommonJS).
- `stats.js` es JS puro (sin DOM): se puede importar en Node y testear `computeStats()`.

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
Para añadir uno, mete su `<path>` en `PATHS`; si es de tarea, añádelo también a `TASK_ICONS`.
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
- `wipeData()` borra los stores de datos pero **conserva** ajustes y el flag `seeded`.
- El export **no** incluye `syncUrl`/`syncSecret`/`ntfyTopic` (por seguridad); se reintroducen
  a mano o con "Compartir configuración".
- `APPS_SCRIPT_CODE` en `app.js` es una copia de `apps-script/Code.gs`: si tocas uno, toca el otro.
