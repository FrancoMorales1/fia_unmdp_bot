import { describe, expect, it } from 'vitest';

import {
  MAX_CARACTERES_POR_TRAMO,
  MIN_CARACTERES_PARA_TROCEAR,
  trocearDocumento,
} from './chunking.js';

describe('trocearDocumento', () => {
  it('deja un texto corto como un solo tramo, con el título original', () => {
    const tramos = trocearDocumento('Grupo de WhatsApp', 'https://chat.whatsapp.com/abc');

    expect(tramos).toEqual([
      { indice: 0, titulo: 'Grupo de WhatsApp', contenido: 'https://chat.whatsapp.com/abc' },
    ]);
  });

  it('no parte justo en el umbral', () => {
    const contenido = 'a'.repeat(MIN_CARACTERES_PARA_TROCEAR);
    const tramos = trocearDocumento('Corto', contenido);

    expect(tramos).toHaveLength(1);
    expect(tramos[0]?.titulo).toBe('Corto');
  });

  it('parte un documento largo en tramos numerados', () => {
    const parrafos = Array.from(
      { length: 20 },
      (_, i) => `Párrafo ${String(i + 1)}. ${'x'.repeat(200)}`,
    );
    const tramos = trocearDocumento('Calendario Académico 2026', parrafos.join('\n\n'));

    expect(tramos.length).toBeGreaterThan(1);
    expect(tramos[0]?.titulo).toBe(`Calendario Académico 2026 (tramo 1/${String(tramos.length)})`);
    expect(tramos.at(-1)?.titulo).toBe(
      `Calendario Académico 2026 (tramo ${String(tramos.length)}/${String(tramos.length)})`,
    );
    expect(tramos.every((t, i) => t.indice === i)).toBe(true);
  });

  it('usa el salto de página de pdf-parse como frontera', () => {
    const pagina1 = `ENERO\n\n${'inscripciones a cursadas. '.repeat(80)}`;
    const pagina2 = `JULIO\n\n${'mesas de finales. '.repeat(80)}`;
    const tramos = trocearDocumento('Calendario', `${pagina1}\f${pagina2}`);

    expect(tramos.length).toBeGreaterThan(1);
    expect(tramos.some((t) => t.contenido.includes('ENERO'))).toBe(true);
    expect(tramos.some((t) => t.contenido.includes('JULIO'))).toBe(true);
  });

  it('no produce un tramo vacío si el documento tiene texto', () => {
    const tramos = trocearDocumento('Plan', `${'materia correlativa. '.repeat(200)}`);

    expect(tramos.length).toBeGreaterThan(0);
    expect(tramos.every((t) => t.contenido.trim().length > 0)).toBe(true);
  });

  it('parte un bloque más largo que el tope en vez de tirarlo entero', () => {
    const bloque = 'palabra '.repeat(MAX_CARACTERES_POR_TRAMO);
    const tramos = trocearDocumento('Reglamento', bloque);

    expect(tramos.length).toBeGreaterThan(1);
    expect(tramos.every((t) => t.contenido.length <= MAX_CARACTERES_POR_TRAMO + 50)).toBe(true);
  });

  it('devuelve un tramo vacío si no hay contenido, para no perder el padre', () => {
    expect(trocearDocumento('Vacío', '   ')).toEqual([
      { indice: 0, titulo: 'Vacío', contenido: '' },
    ]);
  });
});
