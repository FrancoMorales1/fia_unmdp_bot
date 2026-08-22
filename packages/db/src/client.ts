import { env, createLogger } from '@fi/core';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema/index.js';

const log = createLogger('db');

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
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
