import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import type { RequestHandler } from 'express';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

/**
 * Helmet with API-appropriate settings.
 *
 * Most of Helmet's value for a JSON API comes from four headers:
 *   - X-Content-Type-Options: nosniff  — stops a browser guessing that a JSON
 *     response is HTML and executing it (the practical XSS vector for an API).
 *   - X-Frame-Options / frame-ancestors — clickjacking, relevant if any endpoint
 *     ever returns HTML (Swagger UI does).
 *   - Strict-Transport-Security — forces HTTPS on subsequent requests.
 *   - Referrer-Policy — keeps URLs with ids out of third-party referrer logs.
 *
 * CSP is left at Helmet's default rather than disabled: it costs nothing for
 * JSON responses and it does protect the Swagger UI page. `crossOriginEmbedderPolicy`
 * is off because it breaks Swagger UI's asset loading and buys an API nothing.
 */
export const securityHeaders: RequestHandler = helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Swagger UI ships inline styles and an inline init script.
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: env.isProduction ? [] : null,
    },
  },
  hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: false } : false,
  referrerPolicy: { policy: 'no-referrer' },
});

/**
 * CORS against an explicit allow-list from CORS_ORIGIN.
 *
 * `origin: '*'` is never used. For an API that accepts credentials the browser
 * refuses a wildcard anyway, and for a bearer-token API a wildcard still means
 * any site can call the API with a token it has stolen from your frontend.
 *
 * Requests with no Origin header (curl, server-to-server, mobile) are allowed —
 * CORS is a browser mechanism and blocking them protects nobody.
 */
const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    logger.warn({ origin }, 'blocked by CORS allow-list');
    // Reject by *not* setting the CORS headers rather than throwing a 500.
    // The browser then blocks the response, which is the correct outcome.
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  // A cross-origin browser client can only read headers listed here. Without
  // the rate-limit trio, frontend code has no way to back off intelligently on
  // a 429 — it can only guess.
  exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
  // Cache the preflight result for 24h so browsers stop re-asking.
  maxAge: 86_400,
};

export const corsMiddleware: RequestHandler = cors(corsOptions);
