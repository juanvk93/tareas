# 🏠 Tareas del Hogar

PWA para controlar y repartir las tareas de casa entre una pareja o familia. Funciona
offline, se instala como app y **opcionalmente** sincroniza los datos entre varios móviles
usando una Google Sheet. Sin servidores, sin cuentas: se publica en **GitHub Pages**.

## ✨ Características

- ✅ Crear y eliminar tareas (fregar, aspiradora, baño, basura…) y personas del hogar.
- 🗓️ Planificador **semanal**: reparte tareas por día y por persona.
- 📝 Apuntar tareas realizadas y ver la actividad del día.
- 📊 Estadísticas: **quién hace más**, porcentajes, puntos por esfuerzo y ranking.
- 👨‍👩‍👧 Sincronización familiar opcional (Google Sheets) para compartir los mismos datos.
- 🔔 Notificaciones al móvil con **ntfy** cuando alguien crea o completa una tarea.
- 🔗 Compartir la configuración con tu pareja mediante un enlace.
- 🌙 Tema oscuro por defecto + claro. Color de acento configurable.
- 💾 Datos en el dispositivo (IndexedDB) con almacenamiento persistente.
- 📲 Instalable como PWA y funcionamiento offline.

## 🚀 Publicar en GitHub Pages

1. Crea un repositorio en GitHub y sube **todos** estos archivos a la raíz.
2. En el repo: **Settings → Pages**.
3. En *Build and deployment* elige **Deploy from a branch**, rama `main`, carpeta `/ (root)`.
4. Espera un minuto y abre la URL que te da GitHub (`https://TU-USUARIO.github.io/TU-REPO/`).
5. En el móvil, ábrela en Chrome/Safari y usa **"Añadir a pantalla de inicio"** para instalarla.

> Las rutas son relativas, así que funciona igual en la raíz o en un subdirectorio del repo.

## 👨‍👩‍👧 Compartir datos con tu pareja o familia (opcional)

La app funciona perfectamente **solo en local**. Si quieres que varios móviles compartan la
misma información, monta un pequeño backend gratuito con Google Sheets (5 minutos, una vez):

1. Crea una **Google Sheet** nueva (hoja de cálculo en blanco).
2. Menú **Extensiones → Apps Script**.
3. Borra el contenido y pega el código de [`apps-script/Code.gs`](apps-script/Code.gs)
   (también puedes copiarlo desde la propia app: **Ajustes → Cómo configurar Google Sheets**).
4. **Implementar → Nueva implementación → Aplicación web**:
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier persona**
5. Autoriza el script cuando lo pida (es tuyo, es seguro).
6. Copia la **URL** que termina en `/exec`.
7. En la app: **Ajustes → Sincronización → URL del Web App**, pega la URL y pulsa
   **Guardar y sincronizar**.
8. Pega **esa misma URL** en el móvil de tu pareja/familia. ¡Listo! Todos verán los mismos datos.

**Seguridad (opcional):** en `Code.gs` puedes poner una `SECRET`. Si lo haces, escribe la misma
clave en **Ajustes → Clave secreta** en cada dispositivo. Así solo quien conozca la clave puede
leer/escribir aunque alguien descubra la URL.

## 🔔 Notificaciones en el móvil (ntfy, opcional)

Cuando alguien **crea** una tarea (en el catálogo o en la planificación semanal) o la
**completa**, todos los móviles del hogar reciben un aviso. Se usa [ntfy](https://ntfy.sh),
gratuito y sin cuentas:

1. Instala la app **ntfy** en cada móvil
   ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) ·
   [iPhone](https://apps.apple.com/app/ntfy/id1625396347)).
2. En la app Tareas: **Ajustes → Notificaciones**, pulsa el botón de la llave para generar
   un tema (p. ej. `tareas-hogar-k3j9x2m1qa`), activa los avisos y pulsa **Guardar**.
3. En ntfy pulsa **+** y suscríbete a **ese mismo tema**. Si lo permite, ponle como nombre
   visible **Tareas Hogar**.
4. Pulsa **Probar** para recibir un aviso de prueba.

> Los nombres de tema de ntfy no admiten espacios: el "grupo" *Tareas Hogar* es el título de
> los avisos y el nombre visible en la app ntfy; el tema real es el identificador aleatorio.
> En ntfy.sh **quien conozca el tema puede leer los avisos**, así que no lo publiques.
> Si quieres control total, ntfy se puede instalar en tu propio servidor (campo *Servidor ntfy*).

Si no hay conexión, el aviso se guarda y se envía al recuperar la red (máximo 24 h).

## 🔗 Configurar el móvil de tu pareja en un paso

**Ajustes → Compartir con tu pareja → Compartir configuración** genera un enlace con la URL de
sincronización, la clave y el tema de ntfy. Envíalo por un canal privado (WhatsApp, Signal…).

- Si lo abre directamente, la app ofrece aplicarlo.
- **En iPhone**, la app instalada en la pantalla de inicio no comparte datos con Safari: es
  mejor copiar el enlace y pegarlo en **Ajustes → «¿Te la han enviado? Pégala aquí»**
  dentro de la app instalada.

## 🧑‍💻 Desarrollo en local

Necesita servirse por HTTP (los módulos y el Service Worker no funcionan con `file://`):

```bash
python3 -m http.server 8765
# abre http://localhost:8765
```

## 🗂️ Versión y cambios

La versión actual y el historial están en la app: **Ajustes → Acerca de → Novedades**.
El detalle técnico del versionado está en [`CLAUDE.md`](CLAUDE.md) y [`js/changelog.js`](js/changelog.js).

## 🔒 Privacidad

Los datos se guardan en tu dispositivo (IndexedDB). Si activas la sincronización, se guardan
además en **tu** Google Sheet, bajo tu cuenta de Google. Si activas las notificaciones, el
texto de cada aviso (nombre de la persona y de la tarea) pasa por el servidor ntfy elegido.
No hay analítica.

**Persistencia:** la app pide almacenamiento persistente para que el navegador no borre los
datos. Instalarla en la pantalla de inicio ayuda a que se conceda (y en iPhone es lo que evita
el borrado automático de Safari). Con la sincronización activa, la Google Sheet hace además
de copia de seguridad.
