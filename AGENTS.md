# AGENTS.md

## Cursor Cloud specific instructions

Bot de WhatsApp/Telegram (monorepo pnpm, Node 24). Servicios de apoyo: Postgres y
Redis. Comandos estándar están en `README.md` y `package.json`; abajo solo van los
detalles no obvios de este entorno.

### Node: activar la 24 antes de cualquier comando pnpm/node
El `node` por defecto de la terminal es v22 (hay un binario del daemon primero en el
`PATH`), pero el repo exige `>=24` con `engine-strict`, así que **pnpm falla** con la
v22. Antes de correr `pnpm`/`node` en una sesión nueva:

```bash
nvm use 24        # o: . "$HOME/.nvm/nvm.sh" && nvm use 24
```

Un login shell (`bash -l`) ya elige la 24 solo. El update script hace el `nvm use 24`
por su cuenta, así que las dependencias ya quedan instaladas al arrancar la sesión.

### Postgres y Redis: instalados nativos, hay que arrancarlos a mano
En este entorno **no se usa Docker** (el `docker compose up` del README se reemplazó por
paquetes nativos). Los datos persisten en el snapshot, pero los procesos no: al empezar
una sesión hay que levantarlos.

```bash
sudo pg_ctlcluster 16 main start     # Postgres 16 en localhost:5432
sudo redis-server /etc/redis/redis.conf --daemonize yes   # Redis en localhost:6379
```

El rol `fi` (password `fi`, superuser) y la base `fi_bot` ya existen y coinciden con el
`DATABASE_URL` del `.env`. El rol es superuser porque la migración `0002` hace
`CREATE EXTENSION` (`unaccent`, `pg_trgm`).

### `.env` y credenciales
Ya hay un `.env` en la raíz con las URLs locales de Postgres/Redis. Dos placeholders:
- `GEMINI_API_KEY` es un placeholder: el bot arranca igual, pero **las respuestas de IA
  (Gemini) fallan** hasta poner una clave real (https://aistudio.google.com/apikey).
- `TELEGRAM_BOT_TOKEN` está vacío: sin él solo corre WhatsApp (imprime un QR para
  vincular). Con token, además levanta Telegram.

Ninguno hace falta para el pipeline de scraping ni para lint/test/build.

### Lint necesita build primero
`pnpm lint` usa ESLint con type-checking y resuelve tipos entre packages desde los
`dist/*.d.ts`. En un árbol limpio da cientos de falsos "type that could not be resolved".
Corré `pnpm build` (o `pnpm check`, que hace build antes de lint) antes de `pnpm lint`.

### Correr el bot / demo sin secretos
`pnpm dev` levanta el bot en watch mode. Para poblar la base con horarios reales de una
sin esperar al cron de las 4am:

```bash
SCRAPPER_AL_INICIAR=true pnpm dev
```

Eso scrapea el sitio MRBS real (`salas.fi.mdp.edu.ar`), parsea la grilla y persiste las
cursadas en Postgres — el pipeline central del producto, testeable sin Gemini ni tokens.
