import express, { type Express } from 'express';
import type { PrismaClientInstance } from '@/database/prisma';
import { env } from '@/config/env';
import { DOCS_PATH } from '@/config/constants';
import { requestId } from '@/middleware/request-id.middleware';
import { httpLogger } from '@/middleware/http-logger.middleware';
import { corsMiddleware, securityHeaders } from '@/middleware/security.middleware';
import { generalLimiter } from '@/middleware/rate-limit.middleware';
import { notFoundHandler } from '@/middleware/not-found.middleware';
import { errorHandler } from '@/middleware/error-handler.middleware';
import { createHealthRouter } from '@/modules/health/health.routes';
import { createApiRouter } from '@/routes/index';
import { mountSwagger } from '@/docs/swagger';

/**
 * Builds the Express application.
 *
 * Deliberately does NOT call `listen` — server.ts owns the process lifecycle.
 * Keeping them apart is what lets the integration tests hand this app straight
 * to Supertest without binding a port.
 *
 * Middleware order below is not arbitrary; each step depends on the one before:
 *
 *   1. trust proxy      — so req.ip is real before anything reads it
 *   2. request id       — so every later log line can be correlated
 *   3. security headers — set before any response can be produced
 *   4. CORS             — must precede routing to answer preflight OPTIONS
 *   5. http logger      — after the id exists, before handlers run
 *   6. body parsers     — with hard size limits
 *   7. rate limiter     — after req.ip is trustworthy
 *   8. routes
 *   9. 404 handler      — only reached if nothing matched
 *  10. error handler    — last, always
 */
export function createApp(prisma: PrismaClientInstance): Express {
  const app = express();

  // ---- 1. Proxy awareness -------------------------------------------------
  // Express trusts X-Forwarded-For only when told to. The value is the number of
  // proxies in front of this process — NOT `true`. With `true`, any client can
  // forge an X-Forwarded-For header, which fakes their IP and defeats the rate
  // limiter. A hop count only trusts the addresses the known proxies appended.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  // Removes `X-Powered-By: Express`, which tells an attacker what to target.
  app.disable('x-powered-by');

  // ---- 2. Correlation id --------------------------------------------------
  app.use(requestId);

  // ---- 3-4. Security ------------------------------------------------------
  app.use(securityHeaders);
  app.use(corsMiddleware);

  // ---- 5. Request logging -------------------------------------------------
  app.use(httpLogger);

  // ---- 6. Body parsing, bounded -------------------------------------------
  // The limit is the defence against a trivial memory-exhaustion attack: without
  // it Express buffers whatever the client sends. Anything over the limit is
  // rejected by the body parser and mapped to a 413 by the error handler.
  app.use(express.json({ limit: env.BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: env.BODY_LIMIT }));

  // ---- Health -------------------------------------------------------------
  // Before the rate limiter, and outside the version prefix: probes must never
  // be throttled and must not move between API versions.
  app.use('/health', createHealthRouter());

  // ---- 7. Rate limiting ---------------------------------------------------
  app.use(generalLimiter);

  // ---- API docs -----------------------------------------------------------
  if (env.SWAGGER_ENABLED) {
    mountSwagger(app, DOCS_PATH);
  }

  // ---- 8. Application routes ----------------------------------------------
  app.use(createApiRouter(prisma));

  // ---- 9-10. Fallbacks ----------------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
