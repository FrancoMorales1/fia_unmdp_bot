import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

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
  obtenerPlanDeEstudio,
  planesDeEstudio,
} = await import('./contexto.js');

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
