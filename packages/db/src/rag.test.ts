import { describe, expect, it } from 'vitest';

import {
  EMBEDDING_DIMENSIONES,
  fusionarPorRRF,
  origenDeHallazgo,
  tituloDeHallazgo,
  vectorALiteral,
} from './rag.js';

describe('vectorALiteral', () => {
  it('serializa un vector de la dimensión esperada', () => {
    const valores = Array.from({ length: EMBEDDING_DIMENSIONES }, (_, i) => i / 1000);
    const literal = vectorALiteral(valores);

    expect(literal.startsWith('[')).toBe(true);
    expect(literal.endsWith(']')).toBe(true);
    expect(literal.split(',')).toHaveLength(EMBEDDING_DIMENSIONES);
  });

  it('rechaza una longitud distinta', () => {
    expect(() => vectorALiteral([1, 2, 3])).toThrow(/768/);
  });

  it('rechaza NaN o infinitos', () => {
    const valores = Array.from({ length: EMBEDDING_DIMENSIONES }, () => 0);
    valores[0] = Number.NaN;
    expect(() => vectorALiteral(valores)).toThrow(/no numéricos/);
  });
});

describe('fusionarPorRRF', () => {
  it('sube un id que aparece en las dos listas', () => {
    const fusion = fusionarPorRRF(
      [
        ['a', 'b', 'c'],
        ['c', 'd', 'a'],
      ],
      3,
    );

    expect(fusion[0]).toBe('a');
    expect(fusion).toContain('c');
    expect(fusion).toHaveLength(3);
  });

  it('respeta el tope y no inventa ids', () => {
    expect(fusionarPorRRF([['x', 'y']], 1)).toEqual(['x']);
  });

  it('devuelve vacío si no hay candidatos', () => {
    expect(fusionarPorRRF([[], []], 5)).toEqual([]);
  });

  it('en empate conserva el que apareció primero', () => {
    expect(fusionarPorRRF([['p'], ['q']], 2)).toEqual(['p', 'q']);
  });
});

describe('tituloDeHallazgo / origenDeHallazgo', () => {
  it('un hit exacto o semántico usa el título del documento', () => {
    expect(origenDeHallazgo({ exacto: true, parcial: true, semantico: false })).toBe('exacto');
    expect(origenDeHallazgo({ exacto: false, parcial: false, semantico: true })).toBe('semantico');
    expect(tituloDeHallazgo('Calendario 2026 (tramo 2/8)', 'exacto', 'finales')).toBe(
      'Calendario 2026 (tramo 2/8)',
    );
    expect(tituloDeHallazgo('Calendario 2026 (tramo 2/8)', 'semantico', 'finales')).toBe(
      'Calendario 2026 (tramo 2/8)',
    );
  });

  it('un hit solo por OR se marca como parcial', () => {
    expect(origenDeHallazgo({ exacto: false, parcial: true, semantico: false })).toBe('parcial');
    expect(tituloDeHallazgo('Plan IINF', 'parcial', 'correlativas')).toBe(
      'COINCIDENCIA PARCIAL: Plan IINF',
    );
  });

  it('sin hits arma el aviso que el prompt ya sabe leer', () => {
    expect(origenDeHallazgo({ exacto: false, parcial: false, semantico: false })).toBe('ninguno');
    expect(tituloDeHallazgo('x', 'ninguno', 'becas')).toBe('SIN COINCIDENCIAS para "becas"');
  });
});
