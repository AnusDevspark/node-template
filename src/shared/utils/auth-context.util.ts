import type { Request } from 'express';
import { ERROR_CODES, UnauthorizedError } from '@/errors';
import type { AuthenticatedUser } from '@/shared/types/authenticated-user.type';

/**
 * Helpers for reading the authenticated user off a request.
 *
 * These take the request explicitly. They never reach into AsyncLocalStorage or
 * any ambient global — a function whose behaviour depends on invisible state is
 * a function you cannot unit test and cannot reason about at the call site.
 */

/** The user if authenticate ran, otherwise undefined. For optionally-protected routes. */
export function getCurrentUser(req: Request): AuthenticatedUser | undefined {
  return req.user;
}

/**
 * The user, or a 401.
 *
 * Use inside a handler mounted behind `authenticate` — it narrows the optional
 * `req.user` to a guaranteed value so downstream code needs no non-null
 * assertion. The throw is a safety net for a route that forgot the middleware.
 */
export function requireAuthenticatedUser(req: Request): AuthenticatedUser {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required', ERROR_CODES.AUTH_TOKEN_MISSING);
  }
  return req.user;
}
