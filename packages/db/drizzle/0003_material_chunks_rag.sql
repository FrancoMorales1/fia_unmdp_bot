-- RAG sobre el material: tramos + embeddings.
--
-- Cada PDF/texto de `material` se parte en `material_chunks` para no mandarle
-- al modelo el documento entero. `embedding vector(768)` es el de
-- gemini-embedding-001 recortado; si el seed corre sin API key queda NULL y
-- la búsqueda degrada a FTS (el índice HNSW ignora los NULL).
--
-- `vector` es de pgvector. El compose usa `pgvector/pgvector:pg17`. En un
-- Postgres gestionado hay que habilitar la extensión desde el panel.

CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint

CREATE TABLE "material_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"indice" integer NOT NULL,
	"titulo" text NOT NULL,
	"contenido" text NOT NULL,
	"embedding" vector(768)
);
--> statement-breakpoint
ALTER TABLE "material_chunks" ADD CONSTRAINT "material_chunks_material_id_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_chunks_material_indice_idx" ON "material_chunks" USING btree ("material_id","indice");--> statement-breakpoint
CREATE INDEX "material_chunks_material_idx" ON "material_chunks" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "material_chunks_busqueda_idx" ON "material_chunks" USING gin (to_tsvector('public.espanol_sin_acentos', "titulo" || ' ' || "contenido"));--> statement-breakpoint
CREATE INDEX "material_chunks_embedding_idx" ON "material_chunks" USING hnsw ("embedding" vector_cosine_ops);
