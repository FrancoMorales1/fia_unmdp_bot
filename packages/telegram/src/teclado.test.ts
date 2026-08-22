import { InlineKeyboard } from 'grammy';
import { describe, expect, it } from 'vitest';

import { marcadoDeRespuesta } from './teclado.js';

describe('marcadoDeRespuesta', () => {
  it('arma un botón por opción, uno por fila', () => {
    const marcado = marcadoDeRespuesta({
      texto: 'Elegí',
      opciones: [
        { id: 'opcion:1', etiqueta: 'Horarios' },
        { id: 'opcion:2', etiqueta: 'Calendario' },
      ],
    });

    expect(marcado).toBeInstanceOf(InlineKeyboard);
    expect((marcado as InlineKeyboard).inline_keyboard).toEqual([
      [{ text: 'Horarios', callback_data: 'opcion:1' }],
      [{ text: 'Calendario', callback_data: 'opcion:2' }],
    ]);
  });

  it('pide texto con force_reply y placeholder', () => {
    expect(
      marcadoDeRespuesta({
        texto: 'Escribí la materia',
        pedirTexto: { placeholder: 'Ej: álgebra' },
      }),
    ).toEqual({ force_reply: true, input_field_placeholder: 'Ej: álgebra' });
  });

  it('recorta el placeholder al máximo que acepta Telegram', () => {
    const marcado = marcadoDeRespuesta({
      texto: 'x',
      pedirTexto: { placeholder: 'a'.repeat(100) },
    });

    expect(marcado).toEqual({ force_reply: true, input_field_placeholder: 'a'.repeat(64) });
  });

  it('no manda reply_markup si la respuesta es solo texto', () => {
    expect(marcadoDeRespuesta({ texto: 'Listo' })).toBeUndefined();
  });
});
