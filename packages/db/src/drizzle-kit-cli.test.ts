import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const wrapper = join(pkgDir, 'scripts/drizzle-kit.mjs');
const require = createRequire(join(pkgDir, 'package.json'));

describe('wrapper de drizzle-kit', () => {
  it('encuentra el CLI sin depender del PATH', () => {
    const resultado = spawnSync(process.execPath, [wrapper, '--help'], {
      encoding: 'utf8',
    });

    expect(resultado.error).toBeUndefined();
    expect(resultado.status).toBe(0);
    expect(`${resultado.stdout}${resultado.stderr}`).toMatch(/drizzle-kit/i);
  });

  it('resuelve esbuild desde @fi/db para que bin.cjs no dependa del linker', () => {
    expect(() => require.resolve('esbuild')).not.toThrow();
  });
});
