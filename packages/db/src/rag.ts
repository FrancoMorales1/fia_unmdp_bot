/**
 * Piezas puras del RAG sobre `material_chunks`.
 *
 * El retrieval híbrido (FTS + embeddings) vive en el bot; acá solo están las
 * funciones que se pueden testear sin Postgres ni Gemini: el literal que
 * entiende pgvector, la fusión de rankings y la etiqueta que lee el prompt.
 */

/** Dimensión fija de `gemini-embedding-001` / `text-embedding-004` recortado. */
export const EMBEDDING_DIMENSIONES = 768;

/** Constante de Reciprocal Rank Fusion. El paper usa 60; no hace falta tunearla. */
export const RRF_K = 60;

/**
 * Serializa un embedding al literal que pgvector castea (`'[0.1,0.2]'::vector`).
 * Rechaza longitudes o valores raros para no interpolar basura en el SQL.
 */
export function vectorALiteral(valores: number[]): string {
  if (valores.length !== EMBEDDING_DIMENSIONES) {
    throw new Error(
      `El embedding tiene ${String(valores.length)} dimensiones; se esperaban ${String(EMBEDDING_DIMENSIONES)}`,
    );
  }
  if (valores.some((v) => !Number.isFinite(v))) {
    throw new Error('El embedding tiene valores no numéricos');
  }
  return `[${valores.join(',')}]`;
}

/**
 * Reciprocal Rank Fusion: junta varias listas ordenadas (FTS, vectores) sin
 * tener que comparar scores de distinta escala.
 *
 * `score(id) = Σ 1 / (k + rank)` con rank 1-based. Empate: gana el que
 * apareció antes en la primera lista.
 */
export function fusionarPorRRF(listas: readonly (readonly string[])[], limite: number): string[] {
  const scores = new Map<string, number>();
  const primeraAparicion = new Map<string, number>();
  let orden = 0;

  for (const lista of listas) {
    lista.forEach((id, indice) => {
      const actual = scores.get(id) ?? 0;
      scores.set(id, actual + 1 / (RRF_K + indice + 1));
      if (!primeraAparicion.has(id)) primeraAparicion.set(id, orden);
      orden += 1;
    });
  }

  return [...scores.entries()]
    .sort((a, b) => {
      const delta = b[1] - a[1];
      if (delta !== 0) return delta;
      return (primeraAparicion.get(a[0]) ?? 0) - (primeraAparicion.get(b[0]) ?? 0);
    })
    .slice(0, limite)
    .map(([id]) => id);
}

export type OrigenHallazgo = 'exacto' | 'parcial' | 'semantico' | 'ninguno';

/**
 * El prompt de Gemini lee el título para saber si afirmar, ofrecer parecido o
 * decir que no está. Un hallazgo semántico (vector, sin palabras en común) es
 * un hit de verdad: se titula como el documento, no como coincidencia parcial.
 */
export function tituloDeHallazgo(titulo: string, origen: OrigenHallazgo, consulta: string): string {
  switch (origen) {
    case 'exacto':
    case 'semantico':
      return titulo;
    case 'parcial':
      return `COINCIDENCIA PARCIAL: ${titulo}`;
    case 'ninguno':
      return `SIN COINCIDENCIAS para "${consulta}"`;
  }
}

export function origenDeHallazgo(args: {
  exacto: boolean;
  parcial: boolean;
  semantico: boolean;
}): OrigenHallazgo {
  if (args.exacto) return 'exacto';
  if (args.semantico) return 'semantico';
  if (args.parcial) return 'parcial';
  return 'ninguno';
}
