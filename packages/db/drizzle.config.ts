import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit corre con el cwd en packages/db, donde no hay ningún `.env` — el
 * de verdad vive en la raíz del monorepo. Sin esto, `process.env.DATABASE_URL`
 * queda undefined y esta config cae siempre al fallback local sin avisar, aunque
 * el `.env` tenga otra cosa (por ejemplo, Supabase). No usa el `dotenv` de npm
 * a propósito, para no sumar una dependencia nueva solo para esto — es el mismo
 * parseo manual que ya usan scripts/seed-material.mjs y seed-planes-estudio.mjs.
 */
function cargarEnvDesde(dir: string): void {
  for (let actual = dir; ;) {
    const candidato = join(actual, '.env');
    if (existsSync(candidato)) {
      for (const linea of readFileSync(candidato, 'utf8').split('\n')) {
        const t = linea.trim();
        if (!t || t.startsWith('#')) continue;
        const idx = t.indexOf('=');
        if (idx === -1) continue;
        const key = t.slice(0, idx).trim();
        const val = t.slice(idx + 1).trim();
        if (!(key in process.env)) process.env[key] = val;
      }
      return;
    }
    const padre = dirname(actual);
    if (padre === actual) return;
    actual = padre;
  }
}

cargarEnvDesde(process.cwd());

const url = process.env.DATABASE_URL ?? 'postgres://fi:fi@localhost:5432/fi_bot';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
