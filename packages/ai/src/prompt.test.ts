import { describe, expect, it } from 'vitest';

import {
  construirPrompt,
  construirPromptDeMateria,
  extraerBloqueLiteral,
  extraerFuentes,
  MAX_CARACTERES_POR_DOCUMENTO,
  partesDeArchivos,
} from './prompt.js';

import type { ConsultaIA } from './types.js';

const consultaBase: ConsultaIA = {
  mensaje: '¿Cuándo son las inscripciones a cursadas?',
  documentos: [],
  instruccionSistema: 'Instrucción de prueba.',
};

describe('construirPrompt', () => {
  it('incluye la consulta del usuario', () => {
    const prompt = construirPrompt(consultaBase);

    expect(prompt).toContain('¿Cuándo son las inscripciones a cursadas?');
  });

  it('avisa al modelo cuando no hay información disponible', () => {
    const prompt = construirPrompt(consultaBase);

    expect(prompt).toContain('No hay información disponible');
  });

  it('numera los documentos y expone su fuente', () => {
    const prompt = construirPrompt({
      ...consultaBase,
      documentos: [
        { titulo: 'Calendario 2026', url: 'https://fi.mdp.edu.ar/calendario', contenido: 'Marzo' },
        { titulo: 'Trámites', url: 'https://fi.mdp.edu.ar/tramites', contenido: 'Alumnos' },
      ],
    });

    expect(prompt).toContain('[1] Calendario 2026');
    expect(prompt).toContain('Fuente: https://fi.mdp.edu.ar/calendario');
    expect(prompt).toContain('[2] Trámites');
  });

  it('trunca documentos largos para no reventar la ventana de contexto', () => {
    const prompt = construirPrompt({
      ...consultaBase,
      documentos: [
        {
          titulo: 'Plan',
          url: 'https://fi.mdp.edu.ar/plan',
          contenido: 'x'.repeat(MAX_CARACTERES_POR_DOCUMENTO + 500),
        },
      ],
    });

    expect(prompt).not.toContain('x'.repeat(MAX_CARACTERES_POR_DOCUMENTO + 1));
    expect(prompt).toContain('x'.repeat(MAX_CARACTERES_POR_DOCUMENTO));
  });

  it('avisa que el bloqueLiteral no lo tiene que repetir, y no lo manda en el prompt', () => {
    const prompt = construirPrompt({
      ...consultaBase,
      documentos: [
        {
          titulo: 'Horarios de "algebra 1a"',
          url: 'https://salas.fi.mdp.edu.ar/',
          contenido: 'Se encontraron 3 clases.',
          bloqueLiteral: 'algebra 1A (T) — lunes 2026-08-24, de 10:00 a 12:00, en Aula 01',
        },
      ],
    });

    expect(prompt).toContain('se agrega aparte');
    expect(prompt).not.toContain('Aula 01');
  });

  it('avisa que el PDF va adjunto en vez de volcar el contenido de texto', () => {
    const prompt = construirPrompt({
      ...consultaBase,
      documentos: [
        {
          titulo: 'Plan de Informática',
          url: 'https://fi.mdp.edu.ar',
          contenido: 'este texto no debería aparecer en el prompt',
          archivoPdf: { datos: 'ZmFrZQ==', mimeType: 'application/pdf' },
        },
      ],
    });

    expect(prompt).toContain('[1] Plan de Informática');
    expect(prompt).toContain('adjunto');
    expect(prompt).not.toContain('este texto no debería aparecer en el prompt');
  });
});

describe('partesDeArchivos', () => {
  it('devuelve una parte inline por cada documento con PDF', () => {
    const partes = partesDeArchivos([
      {
        titulo: 'a',
        url: 'https://x',
        contenido: '',
        archivoPdf: { datos: 'AAA=', mimeType: 'application/pdf' },
      },
      { titulo: 'b', url: 'https://x', contenido: 'texto sin PDF' },
      {
        titulo: 'c',
        url: 'https://x',
        contenido: '',
        archivoPdf: { datos: 'BBB=', mimeType: 'application/pdf' },
      },
    ]);

    expect(partes).toEqual([
      { inlineData: { mimeType: 'application/pdf', data: 'AAA=' } },
      { inlineData: { mimeType: 'application/pdf', data: 'BBB=' } },
    ]);
  });

  it('devuelve vacío si ningún documento tiene PDF', () => {
    expect(partesDeArchivos([{ titulo: 'a', url: 'https://x', contenido: 'texto' }])).toEqual([]);
  });
});

describe('extraerFuentes', () => {
  it('deduplica las URLs', () => {
    const fuentes = extraerFuentes([
      { titulo: 'a', url: 'https://fi.mdp.edu.ar/x', contenido: '' },
      { titulo: 'b', url: 'https://fi.mdp.edu.ar/x', contenido: '' },
      { titulo: 'c', url: 'https://fi.mdp.edu.ar/y', contenido: '' },
    ]);

    expect(fuentes).toEqual(['https://fi.mdp.edu.ar/x', 'https://fi.mdp.edu.ar/y']);
  });
});

describe('extraerBloqueLiteral', () => {
  it('junta los bloques literales de los documentos que traen uno', () => {
    const bloque = extraerBloqueLiteral([
      { titulo: 'a', url: 'https://x', contenido: '', bloqueLiteral: 'línea 1' },
      { titulo: 'b', url: 'https://x', contenido: '', bloqueLiteral: 'línea 2' },
    ]);

    expect(bloque).toBe('línea 1\n\nlínea 2');
  });

  it('devuelve undefined si ningún documento trae uno', () => {
    expect(
      extraerBloqueLiteral([{ titulo: 'a', url: 'https://x', contenido: 'x' }]),
    ).toBeUndefined();
  });
});

describe('construirPromptDeMateria', () => {
  it('lista el catálogo completo y la consulta del alumno', () => {
    const prompt = construirPromptDeMateria({
      consulta: 'seguridad informatica',
      catalogo: ['gestion de seguridad informatica y seguridad en sistemas', 'algebra 1b'],
    });

    expect(prompt).toContain('- gestion de seguridad informatica y seguridad en sistemas');
    expect(prompt).toContain('- algebra 1b');
    expect(prompt).toContain('seguridad informatica');
  });

  it('no manda horarios: en este paso solo se elige el nombre', () => {
    const prompt = construirPromptDeMateria({ consulta: 'algebra', catalogo: ['algebra 1b'] });

    expect(prompt).not.toMatch(/\d{2}:\d{2}/);
    expect(prompt).not.toContain('aula');
  });

  it('avisa cuando el catálogo está vacío', () => {
    expect(construirPromptDeMateria({ consulta: 'algebra', catalogo: [] })).toContain('(vacío)');
  });
});
