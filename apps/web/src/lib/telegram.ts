import { createHmac } from 'node:crypto';

/**
 * Valida el `initData` que manda el WebView de Telegram, según el algoritmo
 * documentado en https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app.
 *
 * Sin esto, cualquiera en internet podría pegarle a `/api/consultar` como si
 * fuera un usuario real de Telegram y gastar cuota de Gemini.
 */
export interface UsuarioTelegram {
  id: number;
  primerNombre: string;
}

const VIGENCIA_INIT_DATA_S = 24 * 60 * 60;

export function validarInitData(
  initData: string,
  botToken: string,
): { usuario: UsuarioTelegram } | { error: string } {
  const params = new URLSearchParams(initData);
  const hashRecibido = params.get('hash');
  if (!hashRecibido) return { error: 'Falta el hash de initData' };
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clave, valor]) => `${clave}=${valor}`)
    .join('\n');

  const claveSecreta = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hashCalculado = createHmac('sha256', claveSecreta).update(dataCheckString).digest('hex');

  if (hashCalculado !== hashRecibido) return { error: 'initData inválido: el hash no coincide' };

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > VIGENCIA_INIT_DATA_S) {
    return { error: 'initData vencido: volvé a abrir la Mini App desde Telegram' };
  }

  const usuarioCrudo = params.get('user');
  if (!usuarioCrudo) return { error: 'Falta el usuario en initData' };

  try {
    const usuario: unknown = JSON.parse(usuarioCrudo);
    if (
      typeof usuario !== 'object' ||
      usuario === null ||
      typeof (usuario as { id?: unknown }).id !== 'number'
    ) {
      return { error: 'El usuario de initData no tiene el formato esperado' };
    }
    const { id, first_name: primerNombre } = usuario as { id: number; first_name?: unknown };
    return { usuario: { id, primerNombre: typeof primerNombre === 'string' ? primerNombre : '' } };
  } catch {
    return { error: 'El usuario de initData no es JSON válido' };
  }
}
