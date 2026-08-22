import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/coverage/**',
    '**/node_modules/**',
    '**/drizzle/**',
    '**/.turbo/**',
    '**/.next/**',
    'apps/web/next-env.d.ts',
    'pnpm-lock.yaml',
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          conditionNames: ['development', 'types', 'import', 'default'],
          project: ['packages/*/tsconfig.json', 'apps/*/tsconfig.json'],
          noWarnOnMultipleProjects: true,
        }),
      ],
    },
    rules: {
      // --- Tipos ---
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',

      // --- Imports ---
      'import-x/no-default-export': 'error',
      // Falsos positivos constantes con paquetes CJS que exportan default + named
      // (baileys, puppeteer, typescript-eslint). No aportan nada.
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',
      'import-x/no-cycle': ['error', { maxDepth: Infinity }],
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          pathGroups: [{ pattern: '@fi/**', group: 'internal', position: 'before' }],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // --- Higiene general ---
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.meta.name='process'][property.name='env']",
          message: 'Leé la config validada desde @fi/core (env), no process.env directo.',
        },
      ],
    },
  },

  // Archivos de configuración y scripts utilitarios: fuera del type-checking del proyecto.
  {
    files: [
      '**/*.config.{js,mjs,ts}',
      '**/*.setup.ts',
      'scripts/**/*.mjs',
      'packages/*/scripts/**/*.mjs',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      'import-x/no-default-export': 'off',
      'import-x/no-unresolved': 'off',
      'no-restricted-syntax': 'off',
      'no-console': 'off',
    },
  },

  // Tests: más permisivos.
  {
    files: ['**/*.{test,spec}.ts', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // @fi/core sí puede tocar process.env: es quien valida y expone la config.
  {
    files: ['packages/core/src/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  // apps/web (Next.js): layout/page necesitan default export por convención
  // del framework, y el código de cliente corre en el navegador, no en Node.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'import-x/no-default-export': 'off',
    },
  },

  prettier,
]);
