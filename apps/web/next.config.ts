import type { NextConfig } from 'next';

/**
 * Los @fi/* declaran una condición "development" en sus `exports` para que
 * `tsx --conditions development` (el dev de apps/bot) los reciba como fuente
 * TS sin build previo. Turbopack en `next dev` también activa esa condición
 * -y su resolver no sabe mapear los imports internos `./archivo.js` (estilo
 * NodeNext) a los `.ts` hermanos. Se alía cada paquete directo a su dist/ ya
 * compilado para esquivar el problema, sin tocar los `exports` (que siguen
 * sirviendo para el hot-reload de apps/bot). Por eso hace falta
 * `pnpm build` en la raíz (o `pnpm --filter @fi/web^... build`) antes de
 * `next dev`/`next build`.
 */
function distDe(paquete: string): string {
  return `../../packages/${paquete}/dist/index.js`;
}

const config: NextConfig = {
  turbopack: {
    resolveAlias: {
      '@fi/contexto': distDe('contexto'),
      '@fi/ai': distDe('ai'),
      '@fi/core': distDe('core'),
      '@fi/db': distDe('db'),
      '@fi/scrapper': distDe('scrapper'),
    },
  },
};

export default config;
