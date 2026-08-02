import 'dotenv/config';
import { z } from 'zod';

/**
 * The single place `process.env` is read.
 *
 * Everything else in the codebase imports `env` and gets a fully typed, already
 * validated object. If a required variable is missing or malformed the process
 * exits here, before an HTTP listener ever opens — a server that cannot serve
 * requests must never look healthy.
 */

/** Accepts "15m", "7d", "3600" etc. — the duration format jsonwebtoken understands. */
const durationString = z
  .string()
  .regex(
    /^\d+(?:\.\d+)?\s*(?:ms|s|m|h|d|w|y)?$/i,
    'must be a duration like "15m", "7d" or a number of seconds',
  );

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'boolean' ? value : /^(1|true|yes|on)$/i.test(value)));

const envSchema = z.object({
  // --- Runtime ---
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

  // --- Database ---
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().min(1).optional(),

  // --- JWT ---
  // 32 characters is the floor for a secret that is not trivially brute-forced.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().min(1).default('node-backend-template'),
  JWT_AUDIENCE: z.string().min(1).default('node-backend-template-api'),
  JWT_ACCESS_EXPIRES_IN: durationString.default('15m'),
  JWT_REFRESH_EXPIRES_IN: durationString.default('7d'),

  // --- Password hashing ---
  ARGON2_MEMORY_COST: z.coerce.number().int().min(8192).default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),

  // --- CORS ---
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // --- Logging ---
  // `silent` exists so the test suite can suppress request logging entirely.
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  LOG_PRETTY: booleanFromString.default(false),

  // --- Rate limiting ---
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  // --- Body limits ---
  BODY_LIMIT: z.string().default('100kb'),

  // --- Docs ---
  SWAGGER_ENABLED: booleanFromString.default(true),

  // --- Seed bootstrap (only consumed by prisma/seed.ts) ---
  SEED_ADMIN_EMAIL: z.email().default('admin@example.com'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('ChangeMe123!'),
  SEED_ADMIN_FIRST_NAME: z.string().min(1).default('Admin'),
  SEED_ADMIN_LAST_NAME: z.string().min(1).default('User'),

  // --- Shutdown ---
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Env = z.infer<typeof envSchema> & {
  /** Comma-separated CORS_ORIGIN parsed once into a usable allow-list. */
  corsOrigins: string[];
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
};

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Cannot use the Pino logger here — it depends on this module.
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    console.error(`\nInvalid environment configuration:\n${issues}\n`);
    console.error('Copy .env.example to .env and fill in the missing values.\n');
    process.exit(1);
  }

  const value = parsed.data;

  if (value.NODE_ENV === 'production') {
    // These are the two mistakes that actually ship. Catch them at boot.
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      console.error(
        '\nJWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ in production.\n' +
          'Sharing them lets a leaked access secret mint refresh tokens.\n',
      );
      process.exit(1);
    }
    if (value.CORS_ORIGIN.includes('*')) {
      console.error('\nCORS_ORIGIN must not contain "*" in production.\n');
      process.exit(1);
    }
  }

  const corsOrigins = value.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return {
    ...value,
    corsOrigins,
    isProduction: value.NODE_ENV === 'production',
    isDevelopment: value.NODE_ENV === 'development',
    isTest: value.NODE_ENV === 'test',
  };
}

export const env: Env = loadEnv();
