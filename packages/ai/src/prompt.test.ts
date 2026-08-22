import { describe, expect, it } from 'vitest';

import {
  construirPrompt,
  construirPromptDeMateria,
  extraerFuentes,
  instruccionParaOpcion,
  MAX_CARACTERES_POR_DOCUMENTO,
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

describe('instruccionParaOpcion', () => {
  it('le dice al modelo que un tramo no es el documento entero', () => {
    expect(instruccionParaOpcion(2)).toContain('(tramo N/M)');
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
