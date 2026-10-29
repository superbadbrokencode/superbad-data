// ESLint for the whole repo: `pnpm lint`. CI fails on any warning.
// Type-aware rules read tsconfig.json, so a file outside its include list
// fails lint: add it there. Formatting is Prettier's job (`pnpm format`);
// eslint-config-prettier turns off every rule that would fight it.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    // Source-shaped data for the job's tests, and the data the job writes: not code.
    'jobs/prices/fixture/',
    'data/',
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      eqeqeq: ['error', 'always'],
      // node:test's test() returns a promise the runner awaits itself.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: ['test', 'it', 'describe', 'suite'] },
          ],
        },
      ],
    },
  },

  {
    // packages/core is plain TypeScript with no dependencies and no I/O:
    // it imports only its own files. Its tests may use node:test and node:assert.
    files: ['packages/core/src/**/*.ts'],
    ignores: ['packages/core/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\.{1,2}/)',
              message: 'packages/core has no dependencies and no I/O: import only its own files.',
            },
          ],
        },
      ],
    },
  },

  {
    // This file is plain JavaScript outside the tsconfig.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
]);
