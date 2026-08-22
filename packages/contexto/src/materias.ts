/**
 * Normaliza para comparar, no para mostrar: minúsculas, sin acentos, sin
 * puntuación y con los espacios colapsados.
 */
function clave(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Se queda solo con las materias que existen de verdad en el catálogo.
 *
 * El modelo tiene la instrucción de copiar los nombres tal cual, pero a veces
 * los "arregla" —les pone acentos, expande una abreviatura, cambia números
 * romanos por arábigos—. Si ese nombre inventado fuera derecho a la consulta
 * SQL, el `WHERE materia = ANY(...)` no traería nada y el bot diría que no hay
 * clases de una materia que sí existe. Acá se lo empareja de vuelta contra el
 * catálogo y se devuelve **la grafía del catálogo**, que es la que está en la
 * base.
 *
 * Se preserva el orden en que las devolvió el modelo, que es el de relevancia.
 */
export function validarContraCatalogo(propuestas: string[], catalogo: string[]): string[] {
  const porClave = new Map<string, string>();
  for (const materia of catalogo) {
    // La primera gana: si dos entradas normalizan igual, da lo mismo cuál.
    if (!porClave.has(clave(materia))) porClave.set(clave(materia), materia);
  }

  const elegidas: string[] = [];
  for (const propuesta of propuestas) {
    const real = porClave.get(clave(propuesta));
    if (real !== undefined && !elegidas.includes(real)) elegidas.push(real);
  }

  return elegidas;
}
