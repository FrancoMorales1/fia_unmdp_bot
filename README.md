# Bot de WhatsApp y Telegram - Facultad de Ingeniería, UNMdP

Asistente de WhatsApp y Telegram que responde **horarios de cursadas** de la
Facultad de Ingeniería de la Universidad Nacional de Mar del Plata: qué día, a
qué hora y en qué aula se dicta cada materia.

Los horarios salen del sistema de reserva de salas de la Facultad
([salas.fi.mdp.edu.ar](https://salas.fi.mdp.edu.ar/)), que corre MRBS. Un job
diario a las 4am trae los próximos 7 días y los deja en Postgres. Al calendario
académico, los planes de estudio y la información de la facultad los carga
`scripts/seed-material.mjs` desde `material/`. Cuando un alumno pregunta, el bot
busca en esa base (RAG: tramos + FTS + embeddings), arma el contexto y se lo
pasa a Gemini.

```
WhatsApp ─┐                ┌──▶ horarios (catálogo → SQL)
          ├──▶ @fi/bot ────┤
Telegram ─┘                ├──▶ material (RAG: FTS + embeddings sobre tramos)
                           └──▶ @fi/ai ──▶ Gemini ──▶ respuesta ──▶ canal

@fi/queue (cron 4am) ──▶ @fi/scrapper ──▶ MRBS ──▶ Postgres
seed-material            ──▶ material + material_chunks (+ embeddings)
```

> **Alcance actual.** El bot responde sobre las cuatro opciones del menú:
> horarios, calendario académico, planes de estudio e información de la facultad.
> Ante cualquier otro tema (inscripciones en SIU, mesas de finales) avisa que no
> sabe y deriva a la web oficial. Es deliberado: solo fuentes verificables.

## Estructura

| Package        | Rol                                                       |
| -------------- | --------------------------------------------------------- |
| `apps/bot`     | Orquestador: cablea los submódulos y programa el scraping |
| `@fi/whatsapp` | Conexión Baileys, recepción y envío de mensajes           |
| `@fi/telegram` | Conexión grammy: menú de botones y celdas de texto        |
| `@fi/ai`       | Armado del prompt y consulta a Gemini                     |
| `@fi/scrapper` | Lectura de la grilla de MRBS y persistencia de horarios   |
| `@fi/db`       | Esquema Drizzle y acceso a Postgres                       |
| `@fi/queue`    | Colas BullMQ sobre Redis (el cron diario)                 |
| `@fi/core`     | Config validada, logger y errores compartidos             |

Los tres submódulos del enunciado son **WhatsApp**, **IA** y **Scrapper**; `db`,
`queue` y `core` existen para que esos tres no se pisen entre sí.

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

`pnpm db:migrate` corre `0002_busqueda_sin_acentos` (`unaccent` + `pg_trgm`) y
`0003_material_chunks_rag` (`vector` / pgvector). Eso pide un rol con permiso
de `CREATE EXTENSION` (el `fi` del docker-compose lo tiene; en un Postgres
gestionado hay que habilitar `unaccent`, `pg_trgm` y `vector` desde el panel).

El compose usa `pgvector/pgvector:pg17`. Si ya tenías el volumen de
`postgres:17-alpine`, recrealo: `docker compose down -v && pnpm services:up`.

Después de migrar, volvé a correr `pnpm db:seed-material` para trocear los PDFs
y (si hay `GEMINI_API_KEY`) calcular embeddings. Sin key el bot busca igual,
solo con FTS sobre los tramos.

Para responder por Telegram hace falta `TELEGRAM_BOT_TOKEN` (lo da @BotFather).
Sin token el bot arranca igual y responde solo por WhatsApp.

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

### Material: RAG híbrido sobre tramos

El calendario, los planes y la info de la facultad no van enteros al modelo.
`seed-material` parte cada documento en tramos (`material_chunks`) y, si hay
API key, les calcula un embedding con Gemini.

Cuando el alumno pregunta:

1. **FTS** sobre el tramo (`plainto_tsquery`, después OR), igual que antes.
2. **k-NN** por cosine (`embedding <=> consulta`) si ese tramo tiene vector.
3. **RRF** junta las dos listas y se quedan los 5 mejores tramos.

Así "cuándo me anoto a finales" puede caer en el párrafo de mesas aunque no
comparta esas palabras. Si el embedding falla o el seed corrió sin key, queda
solo el FTS: el bot no se cae.

Los horarios **no** se vectorizan: día, hora y aula son filas, no prosa. El
paso 1 del modelo eligiendo del catálogo sigue siendo el retrieval correcto.

Todo corre sobre `espanol_sin_acentos` (`spanish` + `unaccent`). El diccionario
`spanish` pelado stemea pero no normaliza acentos, y MRBS guarda los títulos
como los tipeó cada docente: en la misma grilla conviven "Introducción a la
Matemática Discreta" y "introduccion al modelado computacional". Sin `unaccent`,
la mitad de las búsquedas no matcheaba nunca.

En todos los casos el fragmento **le dice al modelo qué encontró la búsqueda**,
porque un contexto sin etiqueta se lee como "esto es todo lo que hay" y termina
en un "no tengo esa información" que no ayuda a nadie.

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

| Fuente                       | Contenido                                                                             | Actualización                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| MRBS (`salas.fi.mdp.edu.ar`) | Horarios de cursadas: aula, horario, materia, tipo                                    | Cron diario a las 4 am                                          |
| `material/`                  | Calendario académico, planes de estudio, enlaces, infraestructura, grupos de WhatsApp | Script [`scripts/seed-material.mjs`](scripts/seed-material.mjs) |

### Material pendiente para la BBDD

El archivo [`scripts/seed-material.mjs`](scripts/seed-material.mjs) carga lo que
ya está en `material/`. Lo que falta agregar a esa carpeta antes del próximo seed:

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
- El deploy en el servidor definitivo de la Facultad está pendiente; la imagen
  Docker se publica en GHCR pero no hay pipeline de deploy automático.
