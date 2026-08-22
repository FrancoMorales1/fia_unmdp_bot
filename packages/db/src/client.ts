import { env, createLogger } from '@fi/core';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema/index.js';

const log = createLogger('db');

/**
 * `pg` no activa SSL solo a partir de la connection string a menos que traiga
 * `sslmode` explícito. Supabase (y la mayoría de los Postgres gestionados)
 * exige SSL en toda conexión externa, así que se activa automáticamente para
 * cualquier host que no sea local — `rejectUnauthorized: false` porque la
 * cadena de certificados de estos proveedores no siempre está en el store por
 * defecto de Node, y validar el hostname ya lo hace el connectionString.
 */
const esLocal = /^postgres:\/\/[^@]+@(localhost|127\.0\.0\.1)[:/]/.test(env.DATABASE_URL);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: esLocal ? undefined : { rejectUnauthorized: false },
});

pool.on('error', (error) => {
  log.error({ err: error }, 'Error en un cliente idle del pool');
});

export type Database = NodePgDatabase<typeof schema>;

export const db: Database = drizzle(pool, { schema, logger: false });

export async function cerrarConexion(): Promise<void> {
  await pool.end();
  log.info('Pool de Postgres cerrado');
}
