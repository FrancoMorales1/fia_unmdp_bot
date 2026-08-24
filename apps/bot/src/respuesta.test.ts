import { describe, expect, it } from 'vitest';

import type { RespuestaIA } from '@fi/ai';

import { formatearRespuesta } from './respuesta.js';

function respuesta(parcial: Partial<RespuestaIA> = {}): RespuestaIA {
  return { texto: 'Las inscripciones abren en marzo.', fuentes: [], modelo: 'test', ...parcial };
}

describe('formatearRespuesta', () => {
  it('deja el texto tal cual si no hay fuentes', () => {
    expect(formatearRespuesta(respuesta())).toBe('Las inscripciones abren en marzo.');
  });

  it('agrega las fuentes al pie', () => {
    const salida = formatearRespuesta(respuesta({ fuentes: ['https://fi.mdp.edu.ar/calendario'] }));

    expect(salida).toContain('_Fuentes:_');
    expect(salida).toContain('https://fi.mdp.edu.ar/calendario');
  });

  it('no repite una fuente que el modelo ya citó en el texto', () => {
    const url = 'https://fi.mdp.edu.ar/calendario';
    const salida = formatearRespuesta(respuesta({ texto: `Mirá ${url}`, fuentes: [url] }));

    expect(salida).toBe(`Mirá ${url}`);
  });

  it('corta como mucho a 3 fuentes', () => {
    const fuentes = ['a', 'b', 'c', 'd', 'e'].map((n) => `https://fi.mdp.edu.ar/${n}`);
    const salida = formatearRespuesta(respuesta({ fuentes }));

    expect(salida).toContain('https://fi.mdp.edu.ar/c');
    expect(salida).not.toContain('https://fi.mdp.edu.ar/d');
  });

  it('nunca supera el límite de WhatsApp, ni con fuentes', () => {
    const salida = formatearRespuesta(
      respuesta({ texto: 'x'.repeat(9000), fuentes: ['https://fi.mdp.edu.ar/plan'] }),
    );

    expect(salida.length).toBeLessThanOrEqual(4000);
    expect(salida).toContain('_Fuentes:_');
  });
});

describe('formatearRespuesta con bloqueLiteral', () => {
  const bloque =
    '*Horarios de "algebra 1a":*\n\nalgebra 1A (T) — lunes 2026-08-24, de 10:00 a 12:00, en Aula 01';

  it('agrega el bloque literal tal cual después de la intro de la IA', () => {
    const salida = formatearRespuesta(respuesta({ texto: 'Encontré esto:' }), bloque);

    expect(salida).toContain('Encontré esto:');
    expect(salida).toContain(bloque);
  });

  it('el bloque literal nunca se corta a la mitad de un renglón', () => {
    const lineas = Array.from(
      { length: 200 },
      (_, i) => `Materia ${String(i)} — lunes 2026-08-24, de 10:00 a 12:00, en Aula ${String(i)}`,
    );
    const bloqueLargo = lineas.join('\n');

    const salida = formatearRespuesta(respuesta({ texto: 'Encontré esto:' }), bloqueLargo);

    expect(salida.length).toBeLessThanOrEqual(4000);
    // Cada línea que sobrevive está entera: nunca aparece un renglón sin su
    // "en Aula N" final.
    for (const linea of salida.split('\n')) {
      if (linea.startsWith('Materia')) expect(linea).toMatch(/en Aula \d+$/);
    }
  });

  it('si el bloque literal ocupa casi todo el límite, recorta la intro de la IA, no el bloque', () => {
    const bloqueLargo = 'x'.repeat(3900);
    const salida = formatearRespuesta(
      respuesta({ texto: 'Una introducción bastante larga que no tiene que cortar el bloque.' }),
      bloqueLargo,
    );

    expect(salida).toContain(bloqueLargo);
  });
});
