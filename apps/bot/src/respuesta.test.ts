import { describe, expect, it } from 'vitest';

import type { RespuestaIA } from '@fi/ai';

import { archivosDeContexto, formatearRespuesta } from './respuesta.js';

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

describe('archivosDeContexto', () => {
  it('deduplica el mismo PDF que aparece en varios tramos', () => {
    const archivo = { ruta: '/material/calendario.pdf', nombre: 'calendario.pdf' };

    expect(
      archivosDeContexto([
        { titulo: 'tramo 1', url: 'https://fi.mdp.edu.ar/', contenido: 'a', archivo },
        { titulo: 'tramo 2', url: 'https://fi.mdp.edu.ar/', contenido: 'b', archivo },
        { titulo: 'enlace', url: 'https://fi.mdp.edu.ar/', contenido: 'c' },
      ]),
    ).toEqual([archivo]);
  });
});
