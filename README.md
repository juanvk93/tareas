# 🏠 Tareas

Lista **compartida** de tareas pendientes para una pareja o familia, al estilo de las apps de
lista de la compra (tipo *Bring*), pero para las tareas de casa y otros recados. Funciona
offline, se instala como app y se publica en **GitHub Pages**: sin servidores propios ni
cuentas. Los datos se comparten a través de **tu** Google Sheet.

## ✨ Cómo funciona

- 👥 **Grupos:** uno **compartido** (p. ej. «Tareas Hogar», con tu pareja) y otro **privado**
  («Mis tareas», solo para ti). El tipo y los avisos se pueden cambiar en la pestaña **Grupo**. Toca el nombre del grupo en la cabecera para cambiar de lista.
- 🙋 En los compartidos, cada móvil define **su persona** («Juan», «Ana»…) y los demás se unen
  con una invitación.
- 🟦 **Hoy:** las tareas pendientes en casillas grandes. Un toque la marca como **resuelta**
  (para todos). Mantén pulsado para editarla.
- ➕ **Añadir:** escribe en «¿Qué hay que hacer?» o toca una tarea del catálogo (Limpieza,
  Ropa, Cocina y compra, Basura, Mascotas y plantas, Otros) o de *Recientes*.
- 🗂️ **Catálogo a tu medida (por grupo):** crea, renombra, reordena o elimina categorías
  (lápiz junto a cada una, «Nueva categoría» al final), añade tareas habituales con la casilla
  «Nueva» y mantén pulsada una para editarla o cambiarla de categoría. Las tareas nuevas que
  escribas se pueden guardar en una categoría. En los grupos compartidos el catálogo es común.
- 📅 **Próximas:** con el botón **+** planificas tareas para otro día (eligiéndolas de tu
  catálogo o escribiendo una nueva) y, si quieres, que se **repitan** (cada día, cada 2 o 3 semanas, cada mes, cada año o cada N días/semanas/meses), o
  que le toquen a alguien en concreto. Las repeticiones previstas también se ven aquí.
- ✅ **Hechas:** historial y quién ha resuelto cuántas esta semana.
- 🔔 **Avisos al móvil** con **ntfy** cuando alguien añade o resuelve una tarea.
- 🌙 Tema oscuro por defecto + claro. 💾 Datos en el móvil (IndexedDB, persistente). 📲 Offline.

## 🚀 Publicar en GitHub Pages

1. Crea un repositorio en GitHub y sube **todos** estos archivos a la raíz.
2. En el repo: **Settings → Pages**.
3. En *Build and deployment* elige **Deploy from a branch**, rama `main`, carpeta `/ (root)`.
4. Espera un minuto y abre la URL que te da GitHub (`https://TU-USUARIO.github.io/TU-REPO/`).
5. En el móvil, ábrela en Chrome/Safari y usa **"Añadir a pantalla de inicio"** para instalarla.

> Las rutas son relativas, así que funciona igual en la raíz o en un subdirectorio del repo.

## 👥 Montar el grupo (una vez)

**Quien crea el grupo (p. ej. Juan):**

1. Abre la app → **Compartido** → nombre del grupo (*Tareas Hogar*) y tu nombre (*Juan*).
   Elige si quieres avisos y deja marcado «Crear también mi grupo privado» si quieres tu lista propia.
2. Conecta Google Sheets (5 minutos, ver abajo) en **Grupo → Compartir tareas**.
3. Pulsa **Grupo → Invitar a alguien** y envía el enlace por WhatsApp/Signal.

**Quien se une (p. ej. Ana):**

1. Abre el enlace → escribe tu nombre (*Ana*) → **Unirme**. Ya veis las mismas tareas y los
   dos aparecéis en **Grupo → Miembros**. Si ya tenías otros grupos, este se añade a la lista.
2. **En iPhone**, la app instalada en la pantalla de inicio no comparte datos con Safari:
   copia el enlace, abre la app instalada → **Unirme a un grupo** → pégalo ahí.

> La invitación incluye la URL de la hoja, la clave y el tema de avisos: compártela solo por
> un canal privado.

**Más grupos:** toca el nombre del grupo en la cabecera → *Nuevo grupo compartido*, *Nuevo grupo
privado* o *Unirme con una invitación*.

### Conectar Google Sheets

> Cada grupo usa **su propia** Google Sheet. En un grupo privado es opcional: sirve para tener
> tus tareas en varios dispositivos o como copia de seguridad.

1. Crea una **Google Sheet** nueva (hoja de cálculo en blanco).
2. Menú **Extensiones → Apps Script**.
3. Borra el contenido y pega el código de [`apps-script/Code.gs`](apps-script/Code.gs)
   (también puedes copiarlo desde la app: **Grupo → Cómo configurar Google Sheets**).
4. **Autoriza el script (imprescindible):** elige la función `doGet` en el desplegable de arriba
   y pulsa **Ejecutar** → *Revisar permisos* → tu cuenta → *Configuración avanzada* →
   *Ir a … (no seguro)* → **Permitir**. Sin este paso Google responde «Acceso denegado» (403) y
   la app muestra un error de sincronización aunque el acceso sea «Cualquier usuario».
5. **Implementar → Nueva implementación → Aplicación web**:
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier usuario** (en inglés, *Anyone*)
6. Copia la **URL** que termina en `/exec`, pégala en **Grupo → Compartir tareas** y pulsa **Guardar**.

Para comprobarlo, abre la URL en una ventana de incógnito: debe mostrar `{"ok":true,...}`.
Si cambias el código o el acceso, crea una **nueva versión** (Gestionar implementaciones → lápiz →
Versión: *Nueva versión*); la URL no cambia.

**Seguridad (opcional):** en `Code.gs` puedes poner una `SECRET` y escribir la misma clave en
**Grupo → Clave secreta**. La invitación ya la incluye, así que tu pareja no tiene que teclearla.

La app sincroniza al abrirla, al volver a ella, al recuperar la conexión, tras cada cambio y
cada minuto mientras está abierta.

## 🔔 Avisos en el móvil (ntfy)

Se activan o desactivan por grupo con el interruptor **Grupo → Avisos al móvil → Enviar avisos**.
Cada grupo tiene su **tema** de [ntfy](https://ntfy.sh) (p. ej. `tareas-hogar-k3j9x2m1qa`), que
viaja en la invitación. En cada móvil:

1. Instala **ntfy** ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) ·
   [iPhone](https://apps.apple.com/app/ntfy/id1625396347)).
2. Pulsa **+** y suscríbete al tema que aparece en **Grupo → Avisos al móvil** (si lo permite,
   ponle como nombre visible el del grupo).
3. Pulsa **Probar**.

> Los temas de ntfy no admiten espacios: «Tareas Hogar» es el título de los avisos y el tema
> real es el identificador aleatorio. En ntfy.sh **quien conozca el tema puede leer los
> avisos**; si quieres control total, ntfy se puede instalar en tu propio servidor.

Sin conexión, el aviso se guarda y se envía al recuperar la red (máximo 24 h).

## 🧑‍💻 Desarrollo en local

Necesita servirse por HTTP (los módulos y el Service Worker no funcionan con `file://`):

```bash
python3 -m http.server 8765
# abre http://localhost:8765
```

## 🗂️ Versión y cambios

La versión actual y el historial están en la app: **Ajustes → Acerca de → Novedades**.
El detalle técnico está en [`CLAUDE.md`](CLAUDE.md) y [`js/changelog.js`](js/changelog.js).

## 🔒 Privacidad

Los datos se guardan en tu dispositivo (IndexedDB) y en **tu** Google Sheet, bajo tu cuenta de
Google. El texto de cada aviso (nombre de la persona y de la tarea) pasa por el servidor ntfy
elegido. No hay analítica.

**Persistencia:** la app pide almacenamiento persistente para que el navegador no borre los
datos. Instalarla en la pantalla de inicio ayuda a que se conceda (y en iPhone es lo que evita
el borrado automático de Safari). La Google Sheet hace además de copia de seguridad.
