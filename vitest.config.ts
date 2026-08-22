import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['{packages,apps}/*/src/**/*.ts'],
      exclude: [
        '**/*.{test,spec}.ts',
        '**/index.ts',
        '**/*.d.ts',
        '**/schema/**',

        // Adaptadores de I/O: son cableado contra servicios externos
        // (WhatsApp, Gemini, Chromium, Postgres, Redis). Se cubren con tests
        // de integración, no unitarios; medirlos acá solo diluye el número.
        'apps/bot/src/main.ts',
        'apps/bot/src/contexto.ts',
        'apps/bot/src/scraping.ts',
        'packages/ai/src/gemini.ts',
        'packages/core/src/env.ts',
        'packages/core/src/logger.ts',
        'packages/db/src/client.ts',
        'packages/queue/src/**',
        'packages/scrapper/src/mrbs.ts',
        'packages/scrapper/src/persistir.ts',
        'packages/whatsapp/src/cliente.ts',
        'packages/telegram/src/cliente.ts',
      ],
      // Umbral sobre la lógica pura, que es lo que sí tiene que estar testeado.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
