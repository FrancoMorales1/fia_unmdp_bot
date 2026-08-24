import type { RespuestaIA } from '@fi/ai';

/** Tope conservador: WhatsApp corta en 4096 y Telegram también. */
const LIMITE_MENSAJE = 4_000;
const MAX_FUENTES = 3;
const SEPARADOR = '\n\n';

/**
 * Saca líneas completas del final hasta que entre en `maxChars`. Nunca corta
 * un renglón a la mitad: un horario partido ("Aula 2" → "Aula") es peor que
 * directamente no mostrarlo, así que se saca la línea entera y se avisa
 * cuántas quedaron afuera.
 */
function recortarPorLineas(bloque: string, maxChars: number): string {
  if (bloque.length <= maxChars) return bloque;

  const lineas = bloque.split('\n');
  let acumulado = '';
  let cortadas = 0;

  for (const [i, linea] of lineas.entries()) {
    const candidato = acumulado ? `${acumulado}\n${linea}` : linea;
    if (candidato.length > maxChars) {
      cortadas = lineas.length - i;
      break;
    }
    acumulado = candidato;
  }

  if (cortadas === 0) return acumulado;

  const aviso = `\n_(+${String(cortadas)} más — pedí la materia puntual para ver todas)_`;
  return acumulado.length + aviso.length <= maxChars ? acumulado + aviso : acumulado;
}

/**
 * Deja la respuesta lista para mandar: recorta al límite del canal y agrega las
 * fuentes al pie, sin repetir las que ya cita el texto.
 *
 * `bloqueLiteral` (día/hora/aula armado directo de la base, ver
 * `FragmentoContexto.bloqueLiteral`) tiene prioridad sobre el texto de la IA:
 * se reserva su lugar primero y nunca se lo corta a la mitad de un renglón.
 * Si no entra todo, lo que se recorta es la introducción de la IA.
 */
export function formatearRespuesta(respuesta: RespuestaIA, bloqueLiteral?: string): string {
  const fuentes = respuesta.fuentes
    .filter((url) => !respuesta.texto.includes(url))
    .slice(0, MAX_FUENTES);

  const pie = fuentes.length > 0 ? `\n\n_Fuentes:_\n${fuentes.join('\n')}` : '';

  if (bloqueLiteral === undefined) {
    const espacioTexto = LIMITE_MENSAJE - pie.length;
    const texto =
      respuesta.texto.length > espacioTexto
        ? `${respuesta.texto.slice(0, espacioTexto - 1).trimEnd()}…`
        : respuesta.texto;

    return texto + pie;
  }

  const espacioParaBloque = Math.max(LIMITE_MENSAJE - pie.length - SEPARADOR.length, 0);
  const bloqueFinal = recortarPorLineas(bloqueLiteral, espacioParaBloque);

  const espacioParaIntro = LIMITE_MENSAJE - pie.length - SEPARADOR.length - bloqueFinal.length;
  const introRecortada =
    respuesta.texto.length > espacioParaIntro
      ? `${respuesta.texto.slice(0, Math.max(espacioParaIntro - 1, 0)).trimEnd()}…`
      : respuesta.texto;
  const intro = espacioParaIntro > 0 ? introRecortada : '';

  const cuerpo = intro ? `${intro}${SEPARADOR}${bloqueFinal}` : bloqueFinal;
  return cuerpo + pie;
}
