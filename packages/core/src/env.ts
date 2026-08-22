import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * El `.env` vive en la raíz del monorepo, pero los scripts corren con el cwd en
 * su propio package (`pnpm dev` => apps/bot). Se sube por el árbol hasta
 * encontrarlo, si no cada package necesitaría su propia copia.
 */
function buscarEnv(desde: string): string | undefined {
  let dir = desde;

  for (;;) {
    const candidato = join(dir, '.env');
    if (existsSync(candidato)) return candidato;

    const padre = dirname(dir);
    if (padre === dir) return undefined;
    dir = padre;
  }
}

const rutaEnv = buscarEnv(process.cwd());
loadDotenv(rutaEnv ? { path: rutaEnv, quiet: true } : { quiet: true });

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
  /** Embeddings del material (RAG). `gemini-embedding-001` admite recorte a 768. */
  GEMINI_EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-001'),

  // WhatsApp / Baileys
  WHATSAPP_SESSION_PATH: z.string().default('./.auth'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),

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
