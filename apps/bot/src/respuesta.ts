import type { RespuestaIA } from '@fi/ai';

/** Tope conservador: WhatsApp corta en 4096 y Telegram también. */
const LIMITE_MENSAJE = 4_000;
const MAX_FUENTES = 3;

/**
 * Deja la respuesta lista para mandar: recorta al límite del canal y agrega las
 * fuentes al pie, sin repetir las que ya cita el texto.
 */
export function formatearRespuesta(respuesta: RespuestaIA): string {
  const fuentes = respuesta.fuentes
    .filter((url) => !respuesta.texto.includes(url))
    .slice(0, MAX_FUENTES);

  const pie = fuentes.length > 0 ? `\n\n_Fuentes:_\n${fuentes.join('\n')}` : '';
  const espacioTexto = LIMITE_MENSAJE - pie.length;

  const texto =
    respuesta.texto.length > espacioTexto
      ? `${respuesta.texto.slice(0, espacioTexto - 1).trimEnd()}…`
      : respuesta.texto;

  return texto + pie;
}
