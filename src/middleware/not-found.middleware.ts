import type { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '@/errors';

/**
 * Catch-all for unmatched routes. Registered after every router and before the
 * error handler, so an unknown path produces the same envelope as every other
 * failure instead of Express's default HTML page.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
}
