import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'Old Website/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      'packages/db/generated/**',
      'packages/db/prisma/migrations/**',
      'docs/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      globals: { ...globals.node },
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
      // Floating promises are how a licence-delivery job silently never runs.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  /**
   * The licence vault guard.
   *
   * `vaultPrisma` connects as the only Postgres role that can read encrypted
   * keys. The whole isolation argument rests on it having exactly one import
   * site, so this makes that a build failure rather than a code-review habit.
   */
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['apps/api/src/vault/**', 'packages/db/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@da/db',
              importNames: ['vaultPrisma'],
              message:
                'vaultPrisma may only be imported inside apps/api/src/vault. Go through the vault module: revealing a key requires a fresh TOTP challenge and a KeyAccessLog entry.',
            },
          ],
        },
      ],
    },
  },

  /**
   * Order notes must never be used as a delivery mechanism again. That habit is
   * how plaintext licence keys and Office 365 passwords ended up sitting in the
   * legacy `wp_comments` table.
   */
  {
    files: ['apps/api/src/orders/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='create'] > ObjectExpression > Property[key.name='data'] > ObjectExpression > Property[key.name=/licenseKey|licenseCode|password/i]",
          message:
            'Secrets never go in an order note. Deliver through the vault and reference the key by id.',
        },
      ],
    },
  },

  // Seeds and scripts legitimately print progress.
  {
    files: ['**/prisma/seed.ts', '**/scripts/**/*.ts', 'workers/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/*.mjs', '**/*.config.ts', '**/*.config.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
