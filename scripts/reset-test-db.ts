import 'dotenv/config';
import { execFileSync } from 'node:child_process';

/**
 * Applies migrations to the test database.
 *
 * Runs before the integration suite. Without it the test database exists (the
 * compose init script creates it) but has no tables, and every test fails on
 * the first TRUNCATE.
 *
 * `migrate deploy` rather than `migrate dev`: it applies existing migrations
 * without ever prompting or generating new ones, which is what a non-interactive
 * test run needs.
 *
 * The URL is passed through PRISMA_DATABASE_URL, which prisma.config.ts prefers
 * over DATABASE_URL — so the dev database is never touched even by accident.
 */

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

if (!testDatabaseUrl) {
  console.error(
    'TEST_DATABASE_URL is not set. Integration tests need their own database — ' +
      'copy .env.example to .env.',
  );
  process.exit(1);
}

if (testDatabaseUrl === process.env['DATABASE_URL']) {
  console.error(
    'TEST_DATABASE_URL must differ from DATABASE_URL. The integration suite truncates ' +
      'every table and would wipe your development data.',
  );
  process.exit(1);
}

console.log('applying migrations to the test database...');

try {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, PRISMA_DATABASE_URL: testDatabaseUrl },
  });
  console.log('test database ready');
} catch {
  console.error('failed to migrate the test database');
  process.exit(1);
}
