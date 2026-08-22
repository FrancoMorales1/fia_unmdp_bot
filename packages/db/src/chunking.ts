/**
 * Parte un documento de la base de conocimiento en tramos que entren en el
 * prompt. Un PDF entero (calendario, plan de estudios) se guardaba en una sola
 * fila y `construirPrompt` lo cortaba a 16.000 caracteres: cualquier fecha o
 * correlativa más abajo desaparecía y el modelo decía que no estaba.
 *
 * Se trocea por página (`\f` de pdf-parse) y por párrafo, no por cantidad fija
 * de tokens: así un tramo suele coincidir con una sección real.
 */

/** Tope de un tramo. Cabe holgado en la ventana y deja lugar a otros fragmentos. */
export const MAX_CARACTERES_POR_TRAMO = 2_400;

/** Caracteres del tramo anterior que se copian al siguiente, para no partir una oración. */
export const SOLAPE_CARACTERES = 200;

/** Por debajo de esto no vale la pena partir: enlaces, grupos, textos cortos. */
export const MIN_CARACTERES_PARA_TROCEAR = 800;

export interface TramoDocumento {
  indice: number;
  titulo: string;
  contenido: string;
}

function bloquesDe(contenido: string): string[] {
  const normalizado = contenido.replace(/\r\n/g, '\n').trim();
  if (normalizado.length === 0) return [];

  const bloques: string[] = [];
  for (const pagina of normalizado.split(/\f/g)) {
    const parrafos = pagina
      .split(/\n{2,}/g)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    bloques.push(...parrafos);
  }
  return bloques;
}

function partirPorTamaño(texto: string): string[] {
  const partes: string[] = [];
  const paso = Math.max(1, MAX_CARACTERES_POR_TRAMO - SOLAPE_CARACTERES);
  for (let i = 0; i < texto.length; i += paso) {
    partes.push(texto.slice(i, i + MAX_CARACTERES_POR_TRAMO));
  }
  return partes;
}

function empaquetar(bloques: string[]): string[] {
  const tramos: string[] = [];
  let actual = '';

  const cerrar = () => {
    if (actual.length > 0) tramos.push(actual);
    actual = '';
  };

  for (const bloque of bloques) {
    if (bloque.length > MAX_CARACTERES_POR_TRAMO) {
      cerrar();
      tramos.push(...partirPorTamaño(bloque));
      continue;
    }

    const candidato = actual.length > 0 ? `${actual}\n\n${bloque}` : bloque;
    if (candidato.length <= MAX_CARACTERES_POR_TRAMO) {
      actual = candidato;
    } else {
      cerrar();
      actual = bloque;
    }
  }
  cerrar();
  return tramos;
}

function conSolape(tramos: string[]): string[] {
  if (tramos.length <= 1) return tramos;

  return tramos.map((tramo, i) => {
    if (i === 0) return tramo;
    const cola = tramos[i - 1]?.slice(-SOLAPE_CARACTERES).trim() ?? '';
    if (cola.length === 0 || tramo.startsWith(cola)) return tramo;
    return `${cola}\n\n${tramo}`;
  });
}

function tituloDeTramo(titulo: string, indice: number, total: number): string {
  return total <= 1 ? titulo : `${titulo} (tramo ${String(indice + 1)}/${String(total)})`;
}

/**
 * Devuelve uno o más tramos listos para persistir. Nunca devuelve un arreglo
 * vacío: un documento sin texto queda como un tramo vacío, para no perder la
 * fila padre.
 */
export function trocearDocumento(titulo: string, contenido: string): TramoDocumento[] {
  const texto = contenido.replace(/\r\n/g, '\n').trim();

  if (texto.length <= MIN_CARACTERES_PARA_TROCEAR) {
    return [{ indice: 0, titulo, contenido: texto }];
  }

  const tramos = conSolape(empaquetar(bloquesDe(texto)));
  const utiles = tramos.length > 0 ? tramos : [texto];

  return utiles.map((tramo, indice) => ({
    indice,
    titulo: tituloDeTramo(titulo, indice, utiles.length),
    contenido: tramo,
  }));
}
