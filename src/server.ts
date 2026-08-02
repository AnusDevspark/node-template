import http from 'node:http';
import { createApp } from '@/app';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { connectDatabase, disconnectDatabase, prisma } from '@/database/prisma';

/**
 * Process entry point: startup ordering, signal handling, graceful shutdown.
 */

async function bootstrap(): Promise<void> {
  // The database connection is established BEFORE the listener opens.
  //
  // If this throws, the process exits and never binds a port. That matters:
  // a container that is listening but cannot reach its database passes a naive
  // TCP health check and receives traffic it can only fail. Better to crash and
  // let the orchestrator retry with backoff.
  //
  // (env is validated even earlier — importing @/config/env exits on bad config.)
  await connectDatabase();

  const app = createApp(prisma);
  const server = http.createServer(app);

  // Slightly above a typical 60s load-balancer idle timeout, so the balancer
  // closes idle connections first. The reverse causes intermittent 502s when
  // Node closes a connection the balancer is about to reuse.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  server.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, docs: env.SWAGGER_ENABLED ? '/api/docs' : 'disabled' },
      `server listening on port ${env.PORT}`,
    );
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.fatal({ port: env.PORT }, 'port is already in use');
    } else {
      logger.fatal({ err: error }, 'server error');
    }
    process.exit(1);
  });

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    // A second Ctrl-C should not start a parallel shutdown.
    if (shuttingDown) {
      logger.warn({ signal }, 'shutdown already in progress');
      return;
    }
    shuttingDown = true;

    logger.info({ signal }, 'shutdown initiated');

    // Hard ceiling. If a request hangs or a socket refuses to close, exiting
    // late is worse than exiting dirty — the orchestrator will SIGKILL anyway,
    // and this way the reason is in the logs.
    const forceExit = setTimeout(() => {
      logger.fatal(
        { timeoutMs: env.SHUTDOWN_TIMEOUT_MS },
        'graceful shutdown timed out, forcing exit',
      );
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);

    // Do not keep the event loop alive purely for this timer.
    forceExit.unref();

    try {
      // 1. Stop accepting new connections. In-flight requests are allowed to
      //    finish; the callback fires once the last one has.
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      logger.info('http server closed');

      // 2. Close idle keep-alive sockets that would otherwise hold the process
      //    open for their full timeout.
      server.closeIdleConnections();

      // 3. Release the database pool only after requests are done, so nothing
      //    in flight loses its connection mid-query.
      await disconnectDatabase();

      clearTimeout(forceExit);
      logger.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'error during shutdown');
      clearTimeout(forceExit);
      process.exit(1);
    }
  }

  // SIGTERM: what Docker, Kubernetes and most process managers send.
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  // SIGINT: Ctrl-C in a terminal.
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // A rejection nobody handled means state is unknown. Log it and shut down
  // rather than continuing in an undefined condition.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    void shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

bootstrap().catch((error: unknown) => {
  logger.fatal({ err: error }, 'failed to start server');
  process.exit(1);
});
