import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'contexto',
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
