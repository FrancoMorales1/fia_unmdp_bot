import { describe, expect, it } from 'vitest';

import { validarContraCatalogo } from './materias.js';

const CATALOGO = [
  'gestion de seguridad informatica y seguridad en sistemas',
  'analisis matematico i',
  'analisis matematico ii',
  'Introducción a la Matemática Discreta',
  'informatica basica',
];

describe('validarContraCatalogo', () => {
  it('acepta el nombre copiado tal cual', () => {
    expect(validarContraCatalogo(['analisis matematico i'], CATALOGO)).toEqual([
      'analisis matematico i',
    ]);
  });

  it('empareja aunque el modelo le agregue acentos o mayúsculas', () => {
    expect(validarContraCatalogo(['Análisis Matemático I'], CATALOGO)).toEqual([
      'analisis matematico i',
    ]);
  });

  it('devuelve la grafía del catálogo, que es la que está en la base', () => {
    // El modelo la "arregla" sin acentos; la base la tiene con acentos.
    expect(validarContraCatalogo(['introduccion a la matematica discreta'], CATALOGO)).toEqual([
      'Introducción a la Matemática Discreta',
    ]);
  });

  it('descarta lo que el modelo se inventó', () => {
    expect(
      validarContraCatalogo(['seguridad informatica', 'analisis matematico i'], CATALOGO),
    ).toEqual(['analisis matematico i']);
  });

  it('conserva el orden de relevancia que dio el modelo', () => {
    expect(
      validarContraCatalogo(['analisis matematico ii', 'analisis matematico i'], CATALOGO),
    ).toEqual(['analisis matematico ii', 'analisis matematico i']);
  });

  it('no repite una materia propuesta dos veces', () => {
    expect(validarContraCatalogo(['informatica basica', 'INFORMÁTICA BÁSICA'], CATALOGO)).toEqual([
      'informatica basica',
    ]);
  });

  it('devuelve vacío si nada del catálogo corresponde', () => {
    expect(validarContraCatalogo(['quimica organica'], CATALOGO)).toEqual([]);
    expect(validarContraCatalogo([], CATALOGO)).toEqual([]);
  });
});
