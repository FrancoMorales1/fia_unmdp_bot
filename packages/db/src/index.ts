export { db, pool, cerrarConexion, type Database } from './client.js';
export { FTS, terminosDeBusqueda, tsqueryOr } from './busqueda.js';
export {
  trocearDocumento,
  MAX_CARACTERES_POR_TRAMO,
  MIN_CARACTERES_PARA_TROCEAR,
} from './chunking.js';
export type { TramoDocumento } from './chunking.js';
export {
  EMBEDDING_DIMENSIONES,
  fusionarPorRRF,
  origenDeHallazgo,
  tituloDeHallazgo,
  vectorALiteral,
} from './rag.js';
export type { OrigenHallazgo } from './rag.js';
export * as schema from './schema/index.js';
export * from './schema/index.js';
