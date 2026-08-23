import { describe, expect, it } from 'vitest';

import { textoPlanElegido, textoPlanSinFiltro } from './textos.js';

describe('textoPlanElegido', () => {
  it('nombra el plan elegido', () => {
    expect(textoPlanElegido('Ingeniería Informática (Plan 2024)')).toContain(
      'Ingeniería Informática (Plan 2024)',
    );
  });
});

describe('textoPlanSinFiltro', () => {
  it('nombra el plan y avisa que el PDF ya se mandó', () => {
    const texto = textoPlanSinFiltro('Ingeniería Informática (Plan 2024)');
    expect(texto).toContain('Ingeniería Informática (Plan 2024)');
    expect(texto).toContain('PDF completo');
  });
});
