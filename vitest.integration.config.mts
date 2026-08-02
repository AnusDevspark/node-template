import { defineConfig } from 'vitest/config';

/**
 * Integration test configuration.
 *
 * These hit a real PostgreSQL database and a real Express app through Supertest.
 * Not SQLite: production runs on Postgres, and testing against a different
 * engine leaves case-insensitive search, enum types, `@db.Date` handling and
 * constraint behaviour untested — precisely the things that break.
 *
 * `fileParallelism: false` runs test files one at a time. The suite truncates
 * shared tables between tests, so parallel files would clobber each other.
 * Sequential is the right trade at this size; if the suite grows large enough to
 * matter, give each worker its own schema rather than reintroducing
 * shared-state races.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globals: false,
    restoreMocks: true,
    setupFiles: ['tests/setup/integration.setup.ts'],
    fileParallelism: false,
    // Argon2 hashing is intentionally slow and several tests create users.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
