import ts from 'typescript';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests: `pnpm --filter @da/api test:int`.
 *
 * They boot the real AppModule against a real Postgres, so they run only when
 * TEST_DATABASE_URL names one — CI's service container, or a throwaway local
 * container (docs/deployment.md, "API"). Without it every suite reports as
 * skipped, and the run passes.
 *
 * Two things differ from the unit config:
 *
 *  - TypeScript is compiled by TypeScript. Vite's esbuild transform does not
 *    emit decorator metadata, and Nest's dependency injection is built on it:
 *    under esbuild every constructor parameter reflects as undefined and the
 *    module graph fails to resolve. `transpileModule` with
 *    `emitDecoratorMetadata` produces what `tsc` produces for the real build.
 *  - Files run one at a time in one process. They share a database, and two
 *    suites paying for the same order number would test the scheduler rather
 *    than the code.
 */
export default defineConfig({
  esbuild: false,
  plugins: [
    {
      name: 'da:typescript-with-decorator-metadata',
      enforce: 'pre',
      transform(code: string, id: string) {
        if (!id.endsWith('.ts') || id.includes('/node_modules/')) return null;
        const output = ts.transpileModule(code, {
          fileName: id,
          compilerOptions: {
            target: ts.ScriptTarget.ES2023,
            module: ts.ModuleKind.ESNext,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            isolatedModules: true,
            esModuleInterop: true,
            sourceMap: true,
            inlineSources: true,
          },
        });
        return { code: output.outputText, map: output.sourceMapText ?? null };
      },
    },
  ],
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['./src/integration/global-setup.ts'],
    setupFiles: ['./src/integration/env.ts'],
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    passWithNoTests: true,
  },
});
