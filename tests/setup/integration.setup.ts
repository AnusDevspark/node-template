import 'dotenv/config';

/**
 * Runs before any integration test module is imported.
 *
 * The critical line is the DATABASE_URL swap. `src/config/env.ts` reads
 * process.env at import time, so this must happen before anything imports the
 * app — which is exactly what a Vitest `setupFiles` entry guarantees.
 *
 * Without it the suite would truncate the development database.
 */

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

if (!testDatabaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests need a database separate from ' +
      'development — they truncate every table between tests. Copy .env.example to .env.',
  );
}

if (testDatabaseUrl === process.env['DATABASE_URL']) {
  throw new Error(
    'TEST_DATABASE_URL must differ from DATABASE_URL. Running the integration suite ' +
      'against the development database would delete its contents.',
  );
}

process.env['DATABASE_URL'] = testDatabaseUrl;
process.env['NODE_ENV'] = 'test';

// Keep test output readable; the app logs on every request otherwise.
process.env['LOG_LEVEL'] = process.env['TEST_LOG_LEVEL'] ?? 'silent';

/**
 * Raise the rate limits for the suite.
 *
 * Every test shares one process, one limiter instance and one apparent client
 * IP, and the auth tests deliberately generate a lot of 401s — under the
 * production limit of 10 failures per window the suite throttles itself and
 * later tests fail with 429s that have nothing to do with what they assert.
 *
 * This does not weaken the tests: rate limiting is a middleware concern that
 * belongs in its own focused test, not an incidental constraint on every other
 * assertion. Set TEST_RATE_LIMIT_MAX low in a dedicated run to exercise it.
 */
process.env['RATE_LIMIT_MAX'] = process.env['TEST_RATE_LIMIT_MAX'] ?? '100000';
process.env['AUTH_RATE_LIMIT_MAX'] = process.env['TEST_AUTH_RATE_LIMIT_MAX'] ?? '100000';
