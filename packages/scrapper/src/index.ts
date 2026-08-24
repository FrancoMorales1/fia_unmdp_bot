import { scrapearHorarios } from './mrbs.js';
import { guardarHorarios } from './persistir.js';

import type { OpcionesScrapper } from './types.js';

/** Scrapea los próximos días y los deja persistidos. Es lo que dispara el cron. */
export async function actualizarHorarios(
  opciones: OpcionesScrapper = {},
): Promise<{ clases: number; fechas: number; fallidas: string[] }> {
  const { clases, fechasOk, fallidas } = await scrapearHorarios(opciones);
  await guardarHorarios(clases, fechasOk);

  return { clases: clases.length, fechas: fechasOk.length, fallidas };
}

export { scrapearHorarios, construirUrl } from './mrbs.js';
export { guardarHorarios } from './persistir.js';
export { parsearDia, segundosAHora } from './parseo.js';
export { parsearTitulo, normalizarMateria } from './titulo.js';
export { buscarNombreCampus } from './mapeoCampus.js';
export {
  fechaEnZona,
  sumarDias,
  proximasFechas,
  diaSemanaDe,
  nombreDiaSemana,
  ZONA_ARGENTINA,
} from './fechas.js';
export type { ClaseScrapeada, OpcionesScrapper, TipoClase, TituloParseado } from './types.js';
