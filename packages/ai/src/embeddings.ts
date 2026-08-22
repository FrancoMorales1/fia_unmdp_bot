/** Misma dimensión que `material_chunks.embedding` (`@fi/db` `EMBEDDING_DIMENSIONES`). */
export const EMBEDDING_DIMENSIONES = 768;

/**
 * Saca los vectores de la respuesta de `embedContent`. El SDK a veces manda
 * `embeddings` (plural) y a veces un solo `embedding`; se aceptan las dos.
 * Un vector de otra dimensión se descarta: no se puede guardar en la columna.
 */
export function extraerVectores(respuesta: unknown): number[][] {
  if (typeof respuesta !== 'object' || respuesta === null) return [];

  const cuerpo = respuesta as {
    embeddings?: unknown;
    embedding?: unknown;
  };

  const crudos: unknown[] = [];
  if (Array.isArray(cuerpo.embeddings)) {
    crudos.push(...(cuerpo.embeddings as unknown[]));
  } else if (cuerpo.embedding) {
    crudos.push(cuerpo.embedding);
  }

  const vectores: number[][] = [];
  for (const item of crudos) {
    const values =
      typeof item === 'object' && item !== null && 'values' in item
        ? (item as { values?: unknown }).values
        : undefined;
    if (!Array.isArray(values)) continue;
    if (!values.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) continue;
    if (values.length !== EMBEDDING_DIMENSIONES) continue;
    vectores.push(values);
  }
  return vectores;
}
