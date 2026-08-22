import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, uniqueIndex, uuid, vector } from 'drizzle-orm/pg-core';

import { material } from './material.js';

/**
 * Tramo de un documento de `material`, con búsqueda léxica y (si se pudo
 * embeber) un vector para k-NN. Se borra con el padre: el seed recrea todo.
 * La dimensión 768 es la de `EMBEDDING_DIMENSIONES` en `rag.ts`.
 */
export const materialChunks = pgTable(
  'material_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    materialId: uuid('material_id')
      .notNull()
      .references(() => material.id, { onDelete: 'cascade' }),

    /** Orden del tramo dentro del documento, 0-based. */
    indice: integer('indice').notNull(),

    titulo: text('titulo').notNull(),
    contenido: text('contenido').notNull(),

    /** Null si el seed corrió sin `GEMINI_API_KEY`: la búsqueda degrada a FTS. */
    embedding: vector('embedding', { dimensions: 768 }),
  },
  (table) => [
    uniqueIndex('material_chunks_material_indice_idx').on(table.materialId, table.indice),
    index('material_chunks_material_idx').on(table.materialId),
    index('material_chunks_busqueda_idx').using(
      'gin',
      sql`to_tsvector('public.espanol_sin_acentos', ${table.titulo} || ' ' || ${table.contenido})`,
    ),
    index('material_chunks_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  ],
);

export type MaterialChunk = typeof materialChunks.$inferSelect;
export type NuevoMaterialChunk = typeof materialChunks.$inferInsert;
