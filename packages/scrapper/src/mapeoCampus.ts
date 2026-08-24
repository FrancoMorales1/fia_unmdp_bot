import { mapeoMateriaCampus } from './data/mapeoMateriaCampus.js';

/**
 * Busca el nombre de la cursada en el campus virtual para una materia ya
 * normalizada (`titulo.ts` → `normalizarMateria`). `undefined` si esa materia
 * no está en el mapeo — no significa que la materia no exista, solo que no se
 * pudo emparejar contra el catálogo (ver mapping/README.md).
 */
export function buscarNombreCampus(materia: string): string | undefined {
  return mapeoMateriaCampus[materia];
}
