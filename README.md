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
  catálogo o escribiendo una nueva), eliges a quién le toca y, si quieres, que se **repitan**:
  cada día, cada 2 o 3 semanas, cada mes, cada año, cada N días/semanas/meses o en días concretos
  («lunes y jueves», «entre semana», «sábados alternos»), contando desde la fecha planificada o
  **desde el día en que se hace** («limpiar filtros cada 10 días»). Las repeticiones previstas
  también se ven aquí. Las repetidas se pueden **pausar** (hasta una fecha o hasta reanudarlas) y
  en **Grupo → Vacaciones** se pausan todas a la vez. Cualquier pendiente se puede **posponer**
  (Mañana, +1 semana u otro día; en las repetidas solo esa vez) y, si quieres, las que se quedan
  sin hacer pasan solas a hoy (Grupo → Tareas sin hacer).
- 🧺 **Rutinas:** un toque en «Limpieza del sábado» (o las que crees) añade todas sus tareas para
  hoy, sin duplicar las que ya estén pendientes. Mantén pulsada una rutina para editarla.
- ✍️ **Escribe con naturalidad:** «Sacar el vidrio el viernes cada 2 semanas», «Regar las plantas
  los lunes y jueves», «Pagar el alquiler el 1 de cada mes», «Comprar pan para Ana»… La app entiende
  la fecha, la repetición y a quién le toca (lo muestra como chips; toca uno para descartarlo).
- ✅ **Hechas:** historial y quién ha resuelto cuántas esta semana.
- 🔔 **Avisos al móvil** con **ntfy** cuando alguien añade o resuelve una tarea.
- 🩺 **Diagnóstico** (Ajustes): si algo no sincroniza o no avisa, muestra qué respondió Google o
  ntfy y permite copiar un informe (sin URLs completas ni claves). Un punto rojo en el botón de
  sincronizar indica que el último intento falló.
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
4. **Autoriza el script (imprescindible):** elige la función `instalarResumenDiario` en el desplegable de arriba
   y pulsa **Ejecutar** → *Revisar permisos* → tu cuenta → *Configuración avanzada* →
   *Ir a … (no seguro)* → **Permitir**. Sin este paso Google responde «Acceso denegado» (403) y
   la app muestra un error de sincronización aunque el acceso sea «Cualquier usuario». (De paso
   activa el resumen diario.)
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
cada minuto mientras está abierta. Solo envía y recibe lo que ha cambiado. Una vez al día, el
script pasa a la pestaña **archivo** de la hoja lo hecho hace más de 90 días y lo borrado hace más
de 60 (no se pierde, pero deja de sincronizarse).

**Actualizar el script:** si en **Grupo** aparece «Tu script de Google es antiguo», pulsa *Cómo
actualizarlo*: pegar el código nuevo, ejecutar `instalarResumenDiario` para autorizarlo y crear una
**nueva versión** de la implementación (la URL no cambia).

**Resumen diario:** en **Grupo → Avisos al móvil** activa *Resumen diario* y elige la hora. El
propio script te envía cada día lo pendiente para hoy a tu tema de ntfy (si no hay nada, no llega).
Necesita haber ejecutado una vez `instalarResumenDiario` en el editor de Apps Script.

## 🔔 Avisos en el móvil (ntfy)

Cada persona tiene **su propio tema** de [ntfy](https://ntfy.sh) en cada grupo compartido, así
**nadie recibe avisos de lo que hace él mismo**: cuando Juan añade o resuelve una tarea, le llega a
Ana, y al revés. Si te asignan una tarea («¿A quién le toca?»), te llega «Juan te ha asignado
«Sacar la basura» para mañana». En los grupos privados no hay avisos de este tipo. En cada móvil:

1. Instala **ntfy** ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) ·
   [iPhone](https://apps.apple.com/app/ntfy/id1625396347)).
2. En **Grupo → Avisos al móvil** activa **Recibir avisos en este móvil** y pulsa **Suscribirme en
   la app ntfy** (en Android se suscribe sola; en iPhone, pulsa **+** en ntfy y escribe tu tema,
   que está en «Tu tema y servidor»).
3. Pulsa **Probar**: el aviso de prueba va a tu propio tema.

Debajo verás si los demás miembros reciben avisos.

> En ntfy.sh **quien conozca un tema puede leer sus avisos**: los temas son aleatorios y no hay que
> publicarlos. Si quieres control total, ntfy se puede instalar en tu propio servidor.

Sin conexión, el aviso se guarda y se envía al recuperar la red (máximo 24 h).

## 🧑‍💻 Desarrollo en local

Necesita servirse por HTTP (los módulos y el Service Worker no funcionan con `file://`):

```bash
python3 -m http.server 8765
# abre http://localhost:8765
```

Pruebas (Node 20+, sin dependencias): `npm test` (lógica y coherencia) y `npm run smoke`
(recorre la app en Chrome headless con un simulador de Google Sheets).

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
