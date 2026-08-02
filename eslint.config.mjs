// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Deliberately small config. It enforces correctness and unsafe-typing rules and
 * leaves all formatting to Prettier (`eslint-config-prettier` disables the overlap).
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'src/generated/**',
      'prisma/migrations/**',
      'node_modules/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Correctness
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'no-return-await': 'off',
      '@typescript-eslint/return-await': 'off',

      // Unsafe typing
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Unused code. `_`-prefixed args are the documented escape hatch.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },

  {
    // `console` is the point of these files.
    files: ['prisma/seed.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['tests/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
