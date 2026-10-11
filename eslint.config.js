import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * ESLint flat configuration.
 *
 * @see docs/conventions/typescript.md
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/packages/database/migrations/**',
      '**/*.config.js',
      '**/*.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Operational .mjs scripts (packages/database/scripts, apps/worker/scripts).
    // Type-aware linting is provided by the dedicated scripts tsconfigs in
    // those directories, discovered automatically by the project service.
    // Node globals (process, console, ...) resolve through @types/node in each
    // scripts project, making the core no-undef rule redundant here — the same
    // rationale typescript-eslint's eslint-recommended applies to typed files.
    // Do NOT replace these tsconfigs with projectService.allowDefaultProject:
    // typescript-eslint 8.70.0 hard-caps default-project matches at 8 files
    // and 14 operational scripts exist.
    //
    // These scripts are intentionally untyped (checkJs: false), so driver
    // results (postgres.js, ioredis, BullMQ) are `any` by design; the
    // no-unsafe-* family would fire only on that intended-untyped surface.
    // Scoped off for .mjs only — never for TypeScript sources. Keep
    // no-floating-promises ON: it caught a real bug (meta-preflight.mjs).
    // no-console is the operator-facing output channel of these CLIs.
    files: ['**/*.mjs'],
    rules: {
      'no-undef': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
