import { describe, expect, it } from 'vitest';

import { EMBEDDING_DIMENSIONES, extraerVectores } from './embeddings.js';

function vector(relleno = 0.1): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONES }, () => relleno);
}

describe('extraerVectores', () => {
  it('lee el arreglo embeddings del SDK', () => {
    const vectores = extraerVectores({ embeddings: [{ values: vector(0.2) }] });

    expect(vectores).toHaveLength(1);
    expect(vectores[0]).toHaveLength(EMBEDDING_DIMENSIONES);
    expect(vectores[0]?.[0]).toBe(0.2);
  });

  it('acepta un único embedding', () => {
    expect(extraerVectores({ embedding: { values: vector() } })).toHaveLength(1);
  });

  it('descarta vectores de otra dimensión o con basura', () => {
    expect(
      extraerVectores({
        embeddings: [
          { values: [1, 2] },
          { values: vector() },
          { values: [...vector(), Number.NaN] },
        ],
      }),
    ).toHaveLength(1);
  });

  it('devuelve vacío ante una respuesta rara', () => {
    expect(extraerVectores(null)).toEqual([]);
    expect(extraerVectores({})).toEqual([]);
    expect(extraerVectores('nope')).toEqual([]);
  });
});
