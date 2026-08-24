export { crearProveedorGemini } from './gemini.js';
export {
  construirPrompt,
  construirPromptDeMateria,
  extraerBloqueLiteral,
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
