export { crearProveedorGemini } from './gemini.js';
export { extraerVectores, EMBEDDING_DIMENSIONES } from './embeddings.js';
export {
  construirPrompt,
  construirPromptDeMateria,
  extraerFuentes,
  instruccionParaOpcion,
  INSTRUCCION_MATERIA,
  INSTRUCCION_POR_OPCION,
  MAX_CARACTERES_POR_DOCUMENTO,
} from './prompt.js';
export type { NumeroOpcionIA } from './prompt.js';
export type {
  ConsultaDeMateria,
  ConsultaIA,
  FragmentoContexto,
  ProveedorIA,
  RespuestaIA,
} from './types.js';
