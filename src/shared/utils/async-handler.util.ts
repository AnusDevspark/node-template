import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Why this is optional here.
 *
 * On Express 4, an async handler that rejected produced an unhandled rejection —
 * the error never reached the error middleware and the request hung. That is why
 * every Express 4 codebase wraps handlers in something like this.
 *
 * Express 5 fixed it: a returned promise that rejects is forwarded to
 * `next(err)` automatically. This template targets Express 5, so controllers
 * work correctly *without* any wrapper, and none of them use one.
 *
 * The helper is kept for two reasons: it makes the intent explicit for readers
 * arriving from Express 4, and if you ever need to wrap every handler in
 * something cross-cutting (timing, per-handler context), this is the seam.
 * It is a pass-through, not a requirement.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}
