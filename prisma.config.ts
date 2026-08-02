import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 reads CLI configuration from this file rather than from the
 * `datasource` block in schema.prisma. Keeping the URL here means the schema
 * file has no environment coupling at all.
 *
 * `PRISMA_DATABASE_URL` lets tooling (the integration test runner, CI) point the
 * CLI at the test database without mutating DATABASE_URL for the whole shell.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['PRISMA_DATABASE_URL'] ?? process.env['DATABASE_URL'],
  },
});
