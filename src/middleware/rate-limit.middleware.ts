import rateLimit, { type Options } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import { env } from '@/config/env';
import { TooManyRequestsError } from '@/errors';

/**
 * Rate limiting.
 *
 * IMPORTANT — the default store is in-memory and therefore *per process*. With
 * N API instances behind a load balancer the effective limit is N times what is
 * configured, and counters reset on every deploy. That is acceptable for a
 * single-instance deploy and is why no Redis dependency is added here.
 *
 * The moment you run more than one instance, swap in a shared store:
 *   npm i rate-limit-redis ioredis
 *   store: new RedisStore({ sendCommand: (...args) => redis.call(...args) })
 * Nothing else in this file changes. See docs/architecture.md.
 */

/** Route the 429 through the normal error pipeline so the body matches every other error. */
function rejectWithError(): Options['handler'] {
  return (_req, _res, next) => {
    next(new TooManyRequestsError());
  };
}

const shared: Partial<Options> = {
  // Send RateLimit-* headers; omit the deprecated X-RateLimit-* ones.
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rejectWithError(),
};

/**
 * General limiter, applied to the whole API.
 * Generous by design — it exists to blunt runaway clients and crude scraping,
 * not to shape normal traffic.
 */
export const generalLimiter: RequestHandler = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  // Health checks must never be rate limited: a throttled probe looks like an
  // outage to the orchestrator and gets the container killed.
  skip: (req: Request) => req.path.startsWith('/health'),
});

/**
 * Strict limiter for credential endpoints (login, register, refresh).
 *
 * This is the actual brute-force control. Ten attempts per 15 minutes per IP
 * makes online password guessing useless while staying invisible to a real user
 * who mistypes a password twice.
 *
 * Counting only failures (`skipSuccessfulRequests`) means a legitimate user
 * with a working password is never locked out by their own activity.
 *
 * IP-based limiting is a blunt instrument — it punishes everyone behind one NAT.
 * Per-account throttling (a failed-attempt counter on the user row, with
 * exponential backoff) is the complementary control; it is left out of the
 * starter because it needs a product decision about lockout behaviour.
 */
export const authLimiter: RequestHandler = rateLimit({
  ...shared,
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
});
