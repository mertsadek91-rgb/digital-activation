import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Unit tests: `pnpm --filter @da/api test`.
 *
 * The integration suite (`*.int.test.ts`) is left out here rather than merely
 * skipped. It needs a real Postgres and its own compile step — see
 * vitest.int.config.ts — and `pnpm test` must stay runnable on any laptop.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.int.test.ts'],
  },
});
