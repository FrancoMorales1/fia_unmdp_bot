import { describe, expect, it } from 'vitest';

import { buscarNombreCampus } from './mapeoCampus.js';

describe('buscarNombreCampus', () => {
  it('devuelve el nombre de campus para una materia mapeada', () => {
    expect(buscarNombreCampus('accion.electricos')).toBe('Accionamientos Eléctricos (Plan 2003)');
  });

  it('devuelve undefined para una materia que no está en el mapeo', () => {
    expect(buscarNombreCampus('esto no existe en ningun catalogo')).toBeUndefined();
  });
});
