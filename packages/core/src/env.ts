import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Sube por el árbol de directorios desde `desde` hasta encontrar uno que
 * tenga `marcador` adentro. Sirve tanto para el `.env` (vive en la raíz del
 * monorepo, pero los scripts corren con el cwd en su propio package —
 * `pnpm dev` => apps/bot) como para ubicar la raíz del repo en general.
 */
function buscarAncestro(desde: string, marcador: string): string | undefined {
  let dir = desde;

  for (;;) {
    const candidato = join(dir, marcador);
    if (existsSync(candidato)) return dir;

    const padre = dirname(dir);
    if (padre === dir) return undefined;
    dir = padre;
  }
}

const dirEnv = buscarAncestro(process.cwd(), '.env');
loadDotenv(dirEnv ? { path: join(dirEnv, '.env'), quiet: true } : { quiet: true });

/**
 * Raíz del monorepo (donde vive `material/`), ubicada por `pnpm-workspace.yaml`
 * en vez de por el `.env` porque en Vercel no hay `.env` —las env vars las
 * inyecta la plataforma— pero el checkout del repo sí incluye ese archivo.
 */
export const RAIZ_MONOREPO =
  buscarAncestro(process.cwd(), 'pnpm-workspace.yaml') ?? dirEnv ?? process.cwd();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Postgres
  DATABASE_URL: z.url().startsWith('postgres'),

  // Redis (BullMQ)
  REDIS_URL: z.url().startsWith('redis').default('redis://localhost:6379'),

  // Gemini
  GEMINI_API_KEY: z.string().min(1),
  // Solo se permiten modelos de la familia Flash (gratuita). Los modelos Pro/Ultra son de pago.
  GEMINI_MODEL: z
    .string()
    .default('gemini-2.5-flash')
    .refine(
      (m) => /^gemini-\d+\.\d+-flash/i.test(m),
      'Solo se permiten modelos gratuitos (familia Flash). Ejemplo: gemini-2.5-flash',
    ),

  // WhatsApp / Baileys
  WHATSAPP_SESSION_PATH: z.string().default('./.auth'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  /**
   * URL pública HTTPS del webhook. Si se configura, el bot recibe los updates
   * de Telegram por webhook en vez de long polling. Sin esto, long polling
   * (el comportamiento de siempre).
   */
  TELEGRAM_WEBHOOK_URL: z.url().optional(),
  /** Puerto local donde escuchar el webhook. Telegram solo acepta 443, 80, 88 u 8443. */
  TELEGRAM_WEBHOOK_PORT: z.coerce.number().int().positive().default(8443),
  /** Valida que los updates recibidos por webhook vengan realmente de Telegram. */
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  /** URL pública (Vercel) de la Mini App. Sin esto no se ofrece el botón para abrirla. */
  WEB_APP_URL: z.url().optional(),

  // Scrapper: sistema de reserva de salas (MRBS) de la Facultad
  SCRAPPER_BASE_URL: z.url().default('https://salas.fi.mdp.edu.ar/index.php'),
  /** area=2 es "CLASES PRESENCIALES"; area=1 es videoconferencia. */
  SCRAPPER_AREA: z.coerce.number().int().positive().default(2),
  /** Cuántos días hacia adelante traer en cada corrida. */
  SCRAPPER_DIAS: z.coerce.number().int().min(1).max(31).default(7),
  SCRAPPER_CRON: z.string().default('0 4 * * *'),
  SCRAPPER_TZ: z.string().default('America/Argentina/Buenos_Aires'),
  /** Corre el scrapeo apenas arranca, sin esperar a las 4am. Útil la primera vez. */
  SCRAPPER_AL_INICIAR: z.stringbool().default(false),

  // Rate limiting por usuario
  /** Máximo de mensajes permitidos por usuario dentro de la ventana. */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /** Duración de la ventana de rate limit en segundos. */
  RATE_LIMIT_WINDOW_S: z.coerce.number().int().positive().default(60),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Única puerta de entrada a `process.env`.
 * Si falta algo, el proceso muere acá y no a mitad de una conversación.
 */
function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const detalle = z.prettifyError(parsed.error);
    throw new Error(`Configuración inválida:\n${detalle}`);
  }

  return parsed.data;
}

export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
