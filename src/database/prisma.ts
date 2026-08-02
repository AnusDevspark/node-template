import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

/**
 * The single PrismaClient for the process.
 *
 * Repositories receive this instance through their constructor (see
 * src/routes/index.ts for the wiring) rather than importing it directly, which
 * is what makes them unit-testable and what lets a service hand a transaction
 * client to a repository instead.
 *
 * Prisma 7 removed the Rust query engine, so a driver adapter is required. We
 * use node-postgres, which also means connection pooling is configured here in
 * plain `pg` terms rather than through Prisma-specific URL parameters.
 */

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  // Pool sizing follows the classic rule: total connections across all API
  // instances must stay under Postgres `max_connections`. Ten per instance is a
  // sane default for a single-node deploy; lower it as you scale horizontally.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const prisma = new PrismaClient({
  adapter,
  log: env.isDevelopment
    ? [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
      ]
    : [{ emit: 'event', level: 'warn' }],
});

if (env.isDevelopment) {
  prisma.$on('query', (event) => {
    logger.debug({ query: event.query, durationMs: event.duration }, 'prisma query');
  });
}

prisma.$on('warn', (event) => {
  logger.warn({ target: event.target }, event.message);
});

/**
 * Fail fast at boot. A process that cannot reach its database must not start
 * listening — otherwise the load balancer sees a healthy port and routes traffic
 * into guaranteed 500s.
 */
export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  logger.info('database connected');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('database disconnected');
}

/** Used by GET /health/ready. Returns false rather than throwing. */
export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error({ err: error }, 'database readiness check failed');
    return false;
  }
}

/** The concrete client type, exported so repositories can name it. */
export type PrismaClientInstance = typeof prisma;

/**
 * What a repository method accepts when it may run inside a transaction.
 *
 * `prisma.$transaction(async (tx) => ...)` hands the callback a client that is
 * missing the top-level lifecycle methods, so this is the narrowed shape both a
 * plain client and a transaction client satisfy. Repositories take this as an
 * optional last argument; services own the transaction boundary.
 */
export type PrismaTransactionClient = Omit<
  PrismaClientInstance,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;
