/** Un fragmento de la base de conocimiento que se le pasa al modelo como contexto. */
export interface FragmentoContexto {
  titulo: string;
  url: string;
  contenido: string;
  archivo?: { ruta: string; nombre: string };
  /**
   * El documento original en base64, para mandárselo a Gemini como PDF nativo
   * en vez de solo el texto extraído en `contenido`. Gemini lee tablas y
   * layout mejor así que de un texto plano, y cobra un costo fijo por página
   * (no por cantidad de texto).
   */
  archivoPdf?: { datos: string; mimeType: string };
}

/** Todo lo que la IA necesita para responder: la consulta natural + contexto de la BBDD. */
export interface ConsultaIA {
  mensaje: string;
  documentos: FragmentoContexto[];
  instruccionSistema: string;
}

export interface RespuestaIA {
  texto: string;
  fuentes: string[];
  modelo: string;
}

/**
 * Primer paso de una consulta de horarios: emparejar lo que escribió el alumno
 * con el catálogo de materias, antes de ir a buscar ninguna clase.
 */
export interface ConsultaDeMateria {
  /** Lo que escribió el alumno, tal cual. */
  consulta: string;
  /** Todas las materias con clases cargadas. Sin horarios: acá solo se elige cuál. */
  catalogo: string[];
}

export interface ProveedorIA {
  responder(consulta: ConsultaIA): Promise<RespuestaIA>;
  /**
   * Devuelve las materias del catálogo que corresponden a la consulta, de la
   * más probable a la menos, o una lista vacía si ninguna corresponde.
   */
  identificarMaterias(consulta: ConsultaDeMateria): Promise<string[]>;
}
