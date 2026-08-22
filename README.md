# Bot de WhatsApp y Telegram - Facultad de Ingeniería, UNMdP

Asistente de WhatsApp y Telegram que responde **horarios de cursadas** de la
Facultad de Ingeniería de la Universidad Nacional de Mar del Plata: qué día, a
qué hora y en qué aula se dicta cada materia.

Los horarios salen del sistema de reserva de salas de la Facultad
([salas.fi.mdp.edu.ar](https://salas.fi.mdp.edu.ar/)), que corre MRBS. Un job
diario a las 4am trae los próximos 7 días y los deja en Postgres. El calendario
académico y la información de la facultad se leen directo de `material/` en
cada consulta (con cache en memoria, no hay round-trip a la base). Los planes
de estudio salen de `planes_estudio` en Postgres, que solo guarda qué PDF le
corresponde a cada carrera y versión — el texto se lee del archivo al momento
de responder, no se guarda extraído. Cuando un alumno pregunta, el bot arma el
contexto y se lo pasa a Gemini.

```
WhatsApp ─┐                ┌──▶ contexto (horarios y planes_estudio en Postgres,
          ├──▶ @fi/bot ────┤     calendario e info de facultad desde material/)
Telegram ─┘                └──▶ @fi/ai ──▶ Gemini ──▶ respuesta ──▶ canal

@fi/queue (cron 4am) ──▶ @fi/scrapper ──▶ MRBS ──▶ Postgres
```

> **Alcance actual.** El bot responde sobre las cuatro opciones del menú:
> horarios, calendario académico, planes de estudio e información de la facultad.
> Ante cualquier otro tema (inscripciones en SIU, mesas de finales) avisa que no
> sabe y deriva a la web oficial. Es deliberado: solo fuentes verificables.

## Estructura

| Package        | Rol                                                                 |
| -------------- | ------------------------------------------------------------------- |
| `apps/bot`     | Orquestador: cablea los submódulos y programa el scraping           |
| `apps/web`     | Mini App de Telegram (Next.js): el mismo menú, sin llenar el chat   |
| `@fi/whatsapp` | Conexión Baileys, recepción y envío de mensajes                     |
| `@fi/telegram` | Conexión grammy: menú de botones y celdas de texto                  |
| `@fi/ai`       | Armado del prompt y consulta a Gemini                               |
| `@fi/contexto` | Base de conocimiento: horarios, calendario, planes de estudio, info |
| `@fi/scrapper` | Lectura de la grilla de MRBS y persistencia de horarios             |
| `@fi/db`       | Esquema Drizzle y acceso a Postgres                                 |
| `@fi/queue`    | Colas BullMQ sobre Redis (el cron diario)                           |
| `@fi/core`     | Config validada, logger y errores compartidos                       |

Los tres submódulos del enunciado son **WhatsApp**, **IA** y **Scrapper**; `db`,
`queue` y `core` existen para que esos tres no se pisen entre sí. `contexto` es
lo que antes vivía adentro de `apps/bot`, separado a su propio package para
que tanto el bot como `apps/web` usen exactamente la misma lógica.

## Stack

Node 24 · TypeScript · pnpm workspaces · Postgres + Drizzle · Redis + BullMQ ·
Baileys · cheerio · Gemini · Vitest · ESLint + Prettier

## Arranque

```bash
pnpm install
cp .env.example .env          # completar GEMINI_API_KEY
pnpm services:up              # Postgres + Redis en Docker
pnpm db:generate && pnpm db:migrate
SCRAPPER_AL_INICIAR=true pnpm dev   # scrapea al toque y muestra el QR
```

Sin `SCRAPPER_AL_INICIAR` la base arranca vacía y el bot no sabe ningún horario
hasta las 4am.

`pnpm db:migrate` corre la migración `0002_busqueda_sin_acentos`, que crea las
extensiones `unaccent` y `pg_trgm`. Eso pide un rol con permiso de
`CREATE EXTENSION` (el `fi` del docker-compose lo tiene; en un Postgres
gestionado hay que habilitarlas desde el panel).

Para responder por Telegram hace falta `TELEGRAM_BOT_TOKEN` (lo da @BotFather).
Sin token el bot arranca igual y responde solo por WhatsApp.

### Telegram por webhook (en vez de polling)

Por defecto Telegram funciona por _long polling_: el bot le pregunta a
Telegram "¿hay mensajes nuevos?" en loop. Configurando `TELEGRAM_WEBHOOK_URL`
pasa a webhook: Telegram le manda los updates directo al bot por HTTP, apenas
llegan. Menos latencia y menos carga, pero el bot necesita quedar expuesto en
una URL pública HTTPS.

**1. Elegí puerto y armá un secreto.** Telegram solo acepta los puertos `443`,
`80`, `88` u `8443` para webhooks — cualquier otro lo rechaza. El secreto es
para que el endpoint verifique que el request vino de Telegram de verdad, no
de cualquiera que le pegue a la URL:

```bash
openssl rand -hex 24   # o cualquier string random largo
```

**2. Completá en `.env`:**

```bash
TELEGRAM_WEBHOOK_URL=https://tu-dominio.com/telegram-webhook
TELEGRAM_WEBHOOK_PORT=8443
TELEGRAM_WEBHOOK_SECRET=el-string-random-del-paso-1
```

La `URL` es lo que Telegram necesita poder resolver desde internet; el
`PUERTO` es donde el proceso del bot escucha _localmente_ — casi siempre van
a ser distintos, porque en el medio hay un proxy/túnel terminando TLS y
reenviando al puerto local.

**3. Exponé el puerto local con HTTPS.** El bot mismo no maneja TLS, así que
hace falta algo delante:

- **Para probar** (dev, sin dominio propio): un túnel tipo
  [ngrok](https://ngrok.com/) — `ngrok http 8443` te da una URL HTTPS pública
  al toque, apuntá `TELEGRAM_WEBHOOK_URL` a esa URL + `/telegram-webhook`.
- **Para producción** (con dominio propio): un reverse proxy con TLS
  automático delante del bot — [Caddy](https://caddyserver.com/) es el más
  simple (`reverse_proxy localhost:8443` y listo, certificado solo). nginx +
  certbot funciona igual, pero es más para armar a mano.

**4. Arrancá el bot normal** (`pnpm dev` o `pnpm start`). Al conectar, llama a
`setWebhook` con esa URL y queda escuchando en el puerto local — el log dice
`Conectado a Telegram (webhook)` en vez de `(polling)`.

**Para volver a polling**: vaciar `TELEGRAM_WEBHOOK_URL` en el `.env` y
reiniciar. El cliente llama a `deleteWebhook` al desconectar prolijamente
(`Ctrl+C`), pero si el proceso muere de golpe capaz hay que borrarlo a mano:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"
```

Se puede confirmar el estado actual del webhook (o que no hay ninguno) con:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

### Telegram no responde en WSL2

Si el bot arranca sin errores, WhatsApp conecta bien, pero Telegram nunca llega
a loguear `Conectado a Telegram` (o tarda muchísimo) revisá si tu WSL2 anuncia
IPv6 en la interfaz sin tener ruta real a internet. Desde Node 20, `net` intenta
conectar por IPv6 primero (Happy Eyeballs) antes de caer a IPv4; en ese escenario
el intento IPv6 nunca resuelve y tumba con `ETIMEDOUT` cada request a la API de
Telegram (WhatsApp no lo sufre porque reusa un socket ya abierto por Baileys, no
hace un request HTTP nuevo por mensaje). Se confirma con:

```bash
curl -6 -m 5 https://api.telegram.org   # si falla al toque, es esto
```

Arreglo: forzar a Node a no probar IPv6.

```bash
NODE_OPTIONS=--no-network-family-autoselection pnpm dev
```

No va en `.env`: `NODE_OPTIONS` lo lee el binario de `node` al arrancar, antes
de que `dotenv` cargue el `.env` dentro del proceso ya corriendo.

Requisitos: Node >= 24 (`nvm use`), pnpm >= 10, Docker.

## Comandos

| Comando              | Qué hace                                       |
| -------------------- | ---------------------------------------------- |
| `pnpm dev`           | Bot en watch mode (tsx, sin build previo)      |
| `pnpm build`         | `tsc -b` sobre todo el monorepo                |
| `pnpm test`          | Vitest en todos los packages                   |
| `pnpm test:coverage` | Tests + reporte de cobertura                   |
| `pnpm lint`          | ESLint con type-checking                       |
| `pnpm format`        | Prettier sobre el repo                         |
| `pnpm check`         | format + lint + build + test (lo mismo que CI) |
| `pnpm clean`         | Borra `dist/`, `.tsbuildinfo` y `coverage/`    |

## Cómo lee los horarios

MRBS renderiza el día como una grilla de aulas (columnas) por franjas de 30
minutos (filas). Una clase de 2 horas es un único `<td rowspan="4">`, así que en
las filas siguientes esa columna **no aparece en el HTML** y las demás celdas
quedan corridas: la posición del `<td>` no es la columna real.

[parseo.ts](packages/scrapper/src/parseo.ts) reconstruye la grilla llevando
cuenta de cuántas filas sigue ocupada cada columna, igual que hace el navegador al
maquetar. Como equivocarse de columna significa mandar a un alumno al aula
equivocada, el recorrido **se autoverifica**: las celdas libres traen su `room` en
el href, así que se compara contra la columna calculada en cada paso y la corrida
falla si algo no cierra.

Detalles que ya están contemplados y testeados:

- Los **domingos** están deshabilitados en MRBS y el server redirige al día
  siguiente; se registran como días sin clases en lugar de guardar datos de otra
  fecha.
- Los **feriados** y sábados aparecen con la grilla entera libre: 0 clases, sin
  error.
- La **zona horaria** es la de Argentina aunque el server corra en UTC.
- Un día que falla no tumba la corrida, y si _ningún_ día trajo clases el scrapeo
  aborta sin tocar la base, para no borrar los horarios buenos.

Los tests corren contra un
[HTML real del sitio](packages/scrapper/src/__fixtures__/) guardado como fixture,
así que verifican el parseo sin depender de la red.

## Cómo busca lo que le preguntan

### Horarios: la materia la elige la IA, no el SQL

Un alumno escribe "seguridad informatica" y la materia se llama **"gestion de
seguridad informatica y seguridad en sistemas"**. Comparten dos palabras de
nueve: ninguna búsqueda por texto —ni FTS, ni trigramas, ni Levenshtein— la
encuentra sin traerse media facultad de arrastre. Es un problema de significado,
así que lo resuelve el modelo, en dos pasos:

1. **Elegir la materia.** Se le pasa el catálogo entero de materias con clases
   cargadas —solo los nombres, **sin horarios**— y la consulta del alumno.
   Devuelve JSON (`responseSchema`, `temperature: 0`) con las materias del
   catálogo que corresponden, de la más probable a la menos, o la lista vacía si
   ninguna tiene que ver.
2. **Buscar y responder.** Con ese nombre exacto se traen las clases de la base
   (`WHERE materia = ANY(...)`) y esas clases —ahora sí con día, hora y aula—
   son el contexto con el que el modelo arma la respuesta final.

El paso 1 no puede confiarse a ciegas: el modelo a veces "arregla" el nombre que
le pidieron copiar (le pone acentos, expande una abreviatura). Por eso
[`validarContraCatalogo`](apps/bot/src/materias.ts) lo empareja de vuelta contra
el catálogo, normalizando para comparar, y devuelve **la grafía que está en la
base**. Lo que no matchea se descarta: una materia inventada daría cero filas y
el bot diría que no hay clases de algo que sí se dicta.

Si el modelo no reconoce nada queda una red de contención determinista —
`plainto_tsquery` sobre el texto literal—, para que un pedido que nombra la
materia tal cual no dependa de que la IA acierte. Y si tampoco eso encuentra,
el fragmento sale marcado `SIN COINCIDENCIAS` con el catálogo entero, así la
respuesta final puede sugerir lo más parecido en vez de cortar la conversación.

### Calendario, planes de estudio e información de la facultad: archivo directo

Estas tres opciones no pasan por búsqueda: se le manda al modelo el archivo
entero como contexto.

- **Calendario** (`material/CALENDARIO ACADEMICO 2026.pdf`) e **información de
  la facultad** (`material/Información de la facultad.txt`) son fijos, así que
  se leen (y el PDF se parsea) una sola vez por proceso y quedan en memoria
  para las próximas consultas.
- **Plan de estudios**: el alumno elige carrera y versión por botones: esos dos
  pasos resuelven, vía la tabla `planes_estudio`, qué PDF puntual le
  corresponde. Ese plan queda como "activo" en la sesión (15 minutos), así que
  las preguntas de seguimiento ("¿y cuántos créditos tiene esa materia?") se
  siguen respondiendo con el mismo archivo sin tener que volver a elegir
  carrera y versión.

`espanol_sin_acentos` (`spanish` + `unaccent`) sigue existiendo, pero ahora solo
lo usan los horarios: el diccionario `spanish` pelado stemea pero no normaliza
acentos, y MRBS guarda los títulos como los tipeó cada docente — en la misma
grilla conviven "Introducción a la Matemática Discreta" y "introduccion al
modelado computacional". Sin `unaccent`, la mitad de las búsquedas no
matcheaba nunca.

## Interfaz

En **Telegram** el menú son botones (`InlineKeyboard`). Al tocar uno, el bot
manda un mensaje con `force_reply`: Telegram abre la celda de texto ya enfocada,
con un placeholder de ejemplo, para agregar contexto —la materia, la carrera, el
trámite— o mandar `-` para ver todo sin filtrar.

Qué tema corresponde a lo que se escribió sale del propio hilo: el pedido lleva
su etiqueta en la primera línea y la respuesta lo cita, así que no hace falta
guardar estado y el flujo sobrevive a un reinicio. Como red de contención, el
último tema elegido queda en memoria 15 minutos, para que un mensaje suelto
—celda cancelada, o WhatsApp, que no tiene hilos— siga la conversación en curso.

En **WhatsApp** no hay botones: `aTextoPlano` aplana la misma respuesta a la
lista numerada de siempre. El bot decide _qué_ ofrecer; cada canal decide cómo
lo dibuja.

Con `WEB_APP_URL` configurada, en Telegram aparece además un botón "📱 Abrir
menú interactivo" que abre `apps/web` como Mini App — mismo menú, pero dentro
de un WebView en vez de mensajes nuevos en el chat. Sin esa variable el botón
no se ofrece (así en dev local, sin URL pública, no queda un botón roto).

## Mini App (`apps/web`)

Next.js (App Router), pensada para vivir en Vercel. Una sola página con
estado de React (menú → horarios/calendario/facultad o carrera → versión →
consulta para plan de estudios) que le pega directo a `@fi/contexto` y
`@fi/ai` desde sus propias API routes — no pasa por `apps/bot` para nada.

```bash
pnpm build                    # los @fi/* se consumen ya compilados (dist/)
pnpm --filter @fi/web dev     # http://localhost:3000
```

Cada request a `/api/consultar` valida el `initData` que manda el WebView de
Telegram (HMAC-SHA256 con `TELEGRAM_BOT_TOKEN`, documentado en
[core.telegram.org/bots/webapps](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app))
y aplica el mismo rate limit por usuario que ya tiene `apps/bot`. Sin eso,
cualquiera en internet podría pegarle al endpoint y gastar cuota de Gemini.

Para probarla de verdad hace falta abrirla dentro de Telegram, lo que exige
HTTPS pública (un preview de Vercel, o un túnel tipo ngrok apuntando a
`next dev` en local).

**Deploy**: Root Directory del proyecto de Vercel = `apps/web`. Env vars:
`DATABASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `TELEGRAM_BOT_TOKEN`.
Importante: `DATABASE_URL` tiene que apuntar a una Postgres alcanzable desde
internet (Supabase u otra) — el Postgres de Docker local no sirve una vez
deployado. Después de deployar, setear `WEB_APP_URL` con la URL de Vercel
para que aparezca el botón en el chat.

WhatsApp y el long polling de Telegram **no entran en este deploy**: los dos
necesitan un proceso corriendo 24/7, algo que Vercel (o cualquier proveedor
serverless) no ofrece. `apps/bot` sigue corriendo donde corre hoy; la Mini
App es una superficie nueva, no un reemplazo.

## Convenciones

Están en [CONTRIBUTING.md](CONTRIBUTING.md): commits, catálogo de versiones y la
regla de que `process.env` solo se toca desde `@fi/core`. No hay CI/CD ni hooks de
git configurados: `pnpm check` (format:check + build + lint + test) se corre a
mano antes de pushear.

## Roadmap

Funcionalidades planificadas para versiones futuras:

- **Novedades** — noticias de la facultad, suspensión de clases por alertas
  meteorológicas o paros, comunicados de bedelía. Requiere una fuente de datos
  oficial (RSS, scraping del sitio web o canal de comunicación interno).

- **Mesas de exámenes** — fecha, aula y horario de cada final. El sistema SIU
  Guaraní expone esta información pero requiere credenciales de alumno para
  acceder. Necesita que cada usuario vincule su cuenta o que la facultad provea
  un acceso institucional.

- **Profesores por materia** — qué docente dicta cada cursada. MRBS registra el
  nombre del responsable de la reserva; con un solo usuario institucional y
  scraping se puede obtener sin que el alumno se matricule.

- **Rating de materias y profesores** — recolección de opiniones de alumnos vía
  WhatsApp, almacenamiento anónimo y consulta de promedios por materia o docente.

## Base de conocimiento

### Fuentes activas

| Fuente                                    | Contenido                                          | Actualización                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| MRBS (`salas.fi.mdp.edu.ar`)              | Horarios de cursadas: aula, horario, materia, tipo | Cron diario a las 4 am                                                                                                           |
| `material/CALENDARIO ACADEMICO 2026.pdf`  | Calendario académico                               | Manual: reemplazar el archivo                                                                                                    |
| `material/Información de la facultad.txt` | Enlaces, infraestructura, grupos de WhatsApp       | Manual: editar el archivo                                                                                                        |
| `material/Plan de estudios/*.pdf`         | Planes de estudio por carrera y versión            | Manual: reemplazar el PDF + [`pnpm db:seed-planes`](scripts/seed-planes-estudio.mjs) si cambia carrera/versión/nombre de archivo |

### Material pendiente para agregar

Lo que falta sumar a `material/Información de la facultad.txt` (se lee entero,
no hace falta ningún seed aparte de editar el archivo):

#### Grupos de WhatsApp

- Grupos por carrera: IINF, ICOM, IELEM, IQ, IMEC, IMAT, IA, IELO, Industrial,
  Electromecánica (actualmente solo existe el grupo general del CEI).
- Grupos por año o nivel (1.º, 2.º, …).
- Grupos por materia de primer año (Análisis I, Álgebra, Física, etc.).
- Grupo de novedades de bedelía o secretaría, si existe.
- Discord oficial de la facultad (pendiente de conseguir el enlace).

#### Enlaces

- Discord oficial de la facultad (marcado como TODO en los datos actuales).
- Instagram y Facebook oficiales de la facultad y de cada departamento.
- Canal de noticias o comunicados (RSS u otro).
- Formularios web: cambio de carrera, renuncia de habilitación, solicitudes varias.
- Catálogo y acceso en línea de la biblioteca universitaria.

#### Infraestructura

- Horarios de atención de bedelía (días y franjas horarias).
- Horarios de secretaría académica.
- Biblioteca: ubicación exacta, horarios, cómo acceder al catálogo.
- Laboratorio de Idiomas: cómo inscribirse al nivel IV, fechas de la prueba de
  suficiencia (requisito de egreso para todos los planes).
- Buffet/comedor: horarios y ubicación.
- WiFi para alumnos: cómo conectarse, credenciales o portal captivo.
- Sala de computación: horarios de acceso libre.

#### Información institucional

- Reglamento de regularidad: inasistencias permitidas y condiciones para
  perder la regularidad.
- Reglamento de promoción sin examen final: requisitos de nota y asistencia.
- Proceso paso a paso de inscripción en SIU Guaraní.
- Renuncia de habilitación: plazo, formulario y consecuencias.
- Proceso de cambio de carrera o de plan de estudios (ventana: 02/02–20/02 según
  el calendario vigente).
- Becas disponibles: universitarias, nacionales (PNBU) y de la facultad.
- Contactos de departamentos: email, teléfono y horario de atención.
- Requisitos de egreso: nivel IV de inglés, Práctica Profesional Supervisada
  (200 hs) y Práctica Sociocomunitaria.

## Pendientes técnicos

- El bot no distingue comisiones cuando el alumno no las nombra: si una materia
  tiene A1 y A2, las lista todas.
- WhatsApp no tiene botones: ahí el menú sigue siendo la lista numerada de
  siempre (`1 análisis matemático`). La estructura de opciones es la misma que
  en Telegram, solo cambia cómo se dibuja.
- Calendario, planes de estudio e información de la facultad se le pasan al
  modelo enteros (sin trocear); lo que no entra en la ventana del modelo se
  corta por el final (`MAX_CARACTERES_POR_DOCUMENTO`). Falta chunkear por
  sección si algún documento llega a superar ese límite.
- El deploy en el servidor definitivo de la Facultad está pendiente; la imagen
  Docker se publica en GHCR pero no hay pipeline de deploy automático.
