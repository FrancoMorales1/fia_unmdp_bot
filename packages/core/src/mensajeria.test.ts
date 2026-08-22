import { describe, expect, it } from 'vitest';

import { aTextoPlano } from './mensajeria.js';

describe('aTextoPlano', () => {
  it('deja pasar un string tal cual', () => {
    expect(aTextoPlano('Hola')).toBe('Hola');
  });

  it('lista las opciones para los canales sin botones', () => {
    const plano = aTextoPlano({
      texto: '¿Sobre qué querés consultar?',
      opciones: [
        { id: 'opcion:1', etiqueta: 'Horarios', atajo: '1' },
        { id: 'opcion:2', etiqueta: 'Calendario', atajo: '2' },
      ],
    });

    expect(plano).toBe('¿Sobre qué querés consultar?\n\n1 - Horarios\n2 - Calendario');
  });

  it('omite las opciones que son solo un atajo visual', () => {
    const plano = aTextoPlano({
      texto: 'La clase es el lunes a las 8.',
      opciones: [{ id: 'opcion:1', etiqueta: 'Horarios', atajo: '1' }],
      opcionesSoloEnBotones: true,
    });

    expect(plano).toBe('La clase es el lunes a las 8.');
  });

  it('no agrega nada cuando la salida es solo texto', () => {
    expect(aTextoPlano({ texto: 'Listo' })).toBe('Listo');
  });
});
