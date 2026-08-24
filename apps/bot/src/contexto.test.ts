import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import type { ProveedorIA } from '@fi/ai';

const execute = vi.fn<(...args: unknown[]) => Promise<{ rows: unknown[] }>>();

vi.mock('@fi/db', () => ({
  db: { execute: (...args: unknown[]) => execute(...args) },
  FTS: 'public.espanol_sin_acentos',
}));

const {
  carrerasDePlanes,
  obtenerContenidoCalendario,
  obtenerContenidoFacultad,
  obtenerContenidoIngreso,
  obtenerContextoDeOpcion,
  obtenerPlanDeEstudio,
  planesDeEstudio,
} = await import('./contexto.js');

function iaFalsa(materias: string[] = []): ProveedorIA {
  return {
    responder: vi.fn(),
    identificarMaterias: vi.fn().mockResolvedValue(materias),
  };
}

function filaCursada(materia: string) {
  return {
    fecha: '2026-08-24',
    dia_semana: 1,
    hora_inicio: '10:00:00',
    hora_fin: '12:00:00',
    materia,
    titulo_crudo: `${materia} (T)`,
    tipo: 'teoria',
    comision: null,
    aula: 'Aula 01',
  };
}

describe('carrerasDePlanes', () => {
  it('devuelve las carreras que trae la consulta', async () => {
    execute.mockResolvedValueOnce({
      rows: [{ carrera: 'Ingeniería en Informática' }, { carrera: 'Ingeniería Química' }],
    });

    await expect(carrerasDePlanes()).resolves.toEqual([
      'Ingeniería en Informática',
      'Ingeniería Química',
    ]);
  });
});

describe('planesDeEstudio', () => {
  it('devuelve las etiquetas de plan de una carrera', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        { etiqueta: 'Ingeniería en Informática (Plan 2010)' },
        { etiqueta: 'Ingeniería en Informática (Plan 2024)' },
      ],
    });

    await expect(planesDeEstudio('Ingeniería en Informática')).resolves.toEqual([
      'Ingeniería en Informática (Plan 2010)',
      'Ingeniería en Informática (Plan 2024)',
    ]);
  });
});

describe('obtenerPlanDeEstudio', () => {
  it('devuelve vacío si no hay ningún plan con esa etiqueta', async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    await expect(obtenerPlanDeEstudio('carrera que no existe (Plan 3000)')).resolves.toEqual([]);
  });

  it('adjunta el PDF nativo del plan encontrado, en base64', async () => {
    execute.mockResolvedValueOnce({
      rows: [{ archivo: 'PLAN 2024 - INFORMATICA.pdf' }],
    });

    const [fragmento] = await obtenerPlanDeEstudio('Ingeniería en Informática (Plan 2024)');

    expect(fragmento?.titulo).toBe('Ingeniería en Informática (Plan 2024)');
    expect(fragmento?.archivo?.nombre).toBe('PLAN 2024 - INFORMATICA.pdf');
    expect(fragmento?.archivoPdf?.mimeType).toBe('application/pdf');
    // "%PDF" en base64: confirma que es el PDF de verdad, no un placeholder.
    expect(fragmento?.archivoPdf?.datos.startsWith('JVBERi0')).toBe(true);
  });
});

describe('obtenerContenidoFacultad', () => {
  it('lee el archivo de información de la facultad', async () => {
    const fragmento = await obtenerContenidoFacultad();

    expect(fragmento.titulo).toBe('Información de la facultad');
    expect(fragmento.contenido.length).toBeGreaterThan(0);
    expect(fragmento.archivo).toBeUndefined();
  });

  it('cachea el contenido: la segunda llamada no vuelve a leer el archivo', () => {
    const primera = obtenerContenidoFacultad();
    const segunda = obtenerContenidoFacultad();

    expect(segunda).toBe(primera);
  });
});

describe('obtenerContenidoCalendario', () => {
  it('adjunta el PDF nativo del calendario académico, en base64', async () => {
    const fragmento = await obtenerContenidoCalendario();

    expect(fragmento.titulo).toBe('Calendario académico 2026');
    expect(fragmento.archivo?.nombre).toBe('CALENDARIO ACADEMICO 2026.pdf');
    expect(fragmento.archivoPdf?.mimeType).toBe('application/pdf');
    expect(fragmento.archivoPdf?.datos.startsWith('JVBERi0')).toBe(true);
  });

  it('cachea el PDF: la segunda llamada no vuelve a leer el archivo', () => {
    const primera = obtenerContenidoCalendario();
    const segunda = obtenerContenidoCalendario();

    expect(segunda).toBe(primera);
  });
});

describe('obtenerContenidoIngreso', () => {
  it('lee la guía de ingreso a Ingeniería 2027', async () => {
    const fragmento = await obtenerContenidoIngreso();

    expect(fragmento.titulo).toBe('Ingreso a Ingeniería 2027');
    expect(fragmento.contenido).toContain('GUÍA DE INGRESO 2027');
    expect(fragmento.archivo).toBeUndefined();
  });

  it('cachea el contenido: la segunda llamada no vuelve a leer el archivo', () => {
    const primera = obtenerContenidoIngreso();
    const segunda = obtenerContenidoIngreso();

    expect(segunda).toBe(primera);
  });
});

describe('obtenerContextoDeOpcion(1, …) — horarios', () => {
  it('agenda sin filtro: el detalle día/hora/aula va en bloqueLiteral, no en lo que ve la IA', async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ total: '2' }] }) // contarClases
      .mockResolvedValueOnce({
        rows: [filaCursada('algebra 1a'), filaCursada('bases de datos')],
      }); // agenda

    const documentos = await obtenerContextoDeOpcion(1, '', iaFalsa());
    if (!Array.isArray(documentos)) throw new Error('esperaba fragmentos, no selección');
    const [fragmento] = documentos;

    expect(fragmento?.contenido).not.toContain('Aula 01');
    expect(fragmento?.contenido).not.toMatch(/\d{2}:\d{2}/);
    expect(fragmento?.bloqueLiteral).toContain('algebra 1a');
    expect(fragmento?.bloqueLiteral).toContain('Aula 01');
    expect(fragmento?.bloqueLiteral).toContain('10:00');
  });

  it('materia encontrada: el detalle día/hora/aula va en bloqueLiteral, no en lo que ve la IA', async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ total: '5' }] }) // contarClases
      .mockResolvedValueOnce({ rows: [{ materia: 'algebra 1a' }] }) // catalogoDeMaterias
      .mockResolvedValueOnce({ rows: [filaCursada('algebra 1a')] }); // clasesDeMaterias

    const documentos = await obtenerContextoDeOpcion(1, 'algebra', iaFalsa(['algebra 1a']));
    if (!Array.isArray(documentos)) throw new Error('esperaba fragmentos, no selección');
    const [fragmento] = documentos;

    expect(fragmento?.contenido).not.toContain('Aula 01');
    expect(fragmento?.contenido).not.toMatch(/\d{2}:\d{2}/);
    expect(fragmento?.contenido).toContain('algebra 1a');
    expect(fragmento?.bloqueLiteral).toContain('Aula 01');
    expect(fragmento?.bloqueLiteral).toContain('10:00');
  });

  it('varias materias encontradas: la selección muestra el nombre de campus, no el de MRBS', async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ total: '5' }] }) // contarClases
      .mockResolvedValueOnce({
        rows: [{ materia: 'bases de datos p' }, { materia: 'bases de datos t' }],
      }) // catalogoDeMaterias
      .mockResolvedValueOnce({
        rows: [
          { materia: 'bases de datos p', nombre_campus: 'Bases de Datos (Plan 2010)' },
          { materia: 'bases de datos t', nombre_campus: 'Bases de Datos (Plan 2010)' },
        ],
      }); // etiquetasDeCampus

    const seleccion = await obtenerContextoDeOpcion(
      1,
      'base de datos',
      iaFalsa(['bases de datos p', 'bases de datos t']),
    );

    if (Array.isArray(seleccion)) throw new Error('esperaba selección, no fragmentos');
    expect(seleccion.materias).toEqual(['bases de datos p', 'bases de datos t']);
    // Las dos mapean al mismo nombre de campus: se desambiguan agregando el
    // nombre de MRBS entre paréntesis, si no el alumno no podría elegir.
    expect(seleccion.etiquetas).toEqual([
      'Bases de Datos (Plan 2010) (bases de datos p)',
      'Bases de Datos (Plan 2010) (bases de datos t)',
    ]);
  });
});

// Referencia cruzada: confirma que el archivo que lee obtenerContenidoFacultad
// existe de verdad y que el fixture no se desincronizó de material/.
describe('archivos de material/', () => {
  it('el archivo de información de la facultad existe', async () => {
    const ruta = new URL('../../../material/Información de la facultad.txt', import.meta.url);
    await expect(readFile(ruta, 'utf8')).resolves.not.toHaveLength(0);
  });

  it('el archivo de ingreso existe', async () => {
    const ruta = new URL(
      '../../../material/ingreso_ingenieria_2027_guia_ingresantes.txt',
      import.meta.url,
    );
    await expect(readFile(ruta, 'utf8')).resolves.not.toHaveLength(0);
  });
});
