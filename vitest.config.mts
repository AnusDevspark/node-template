import { defineConfig } from 'vitest/config';

/**
 * Unit test configuration.
 *
 * Covers tests/unit only. These run without a database, without an HTTP server
 * and without Prisma — services are exercised against plain object stand-ins for
 * their repositories. That is why they are fast enough to run on every save.
 *
 * `.mts` rather than `.ts` because package.json declares `"type": "commonjs"`,
 * and Vite's native config loader needs the explicit ESM extension.
 *
 * `resolve.tsconfigPaths` makes the `@/` aliases work here — the same aliases
 * tsx resolves in dev and tsc-alias rewrites in the build. Vite supports this
 * natively now, so no `vite-tsconfig-paths` plugin is needed.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    globals: false,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/generated/**',
        'src/**/*.d.ts',
        // Wiring and docs are exercised by the integration suite; unit coverage
        // numbers for them would be noise.
        'src/routes/**',
        'src/docs/**',
        'src/server.ts',
      ],
    },
  },
});
