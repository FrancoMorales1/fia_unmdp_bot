import { env } from '@fi/core';

import { excedeLimite } from './rateLimit';
import { validarInitData, type UsuarioTelegram } from './telegram';

const HEADER_INIT_DATA = 'x-telegram-init-data';

/**
 * Valida el `initData` del header y aplica el rate limit por usuario. Lo usan
 * las tres rutas de la API para no repetir el chequeo.
 */
export function autenticar(request: Request): { usuario: UsuarioTelegram } | { error: string } {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { error: 'TELEGRAM_BOT_TOKEN no está configurado en este entorno' };
  }

  const initData = request.headers.get(HEADER_INIT_DATA);
  if (!initData) return { error: `Falta el header ${HEADER_INIT_DATA}` };

  const resultado = validarInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if ('error' in resultado) return resultado;

  if (excedeLimite(resultado.usuario.id)) {
    return {
      error: 'Estás enviando muchos mensajes seguidos. Esperá un momento y volvé a consultar.',
    };
  }

  return resultado;
}
