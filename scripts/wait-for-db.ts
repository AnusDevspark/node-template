import 'dotenv/config';
import { Client } from 'pg';

/**
 * Polls until Postgres accepts connections, or gives up.
 *
 * Compose's `service_healthy` covers the container case; this covers the host
 * case — `docker compose up -d` returns as soon as the container starts, so a
 * `npm run prisma:migrate` fired immediately after can still hit a database
 * that is mid-initialisation.
 */

const url = process.env['DATABASE_URL'];
const timeoutMs = Number(process.env['DB_WAIT_TIMEOUT_MS'] ?? 60_000);
const intervalMs = 1_000;

if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

async function tryConnect(connectionString: string): Promise<boolean> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write('waiting for database');

  while (Date.now() < deadline) {
    if (await tryConnect(url as string)) {
      process.stdout.write(' — ready\n');
      return;
    }
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  process.stdout.write('\n');
  console.error(`database not reachable within ${timeoutMs}ms`);
  process.exit(1);
}

void main();
