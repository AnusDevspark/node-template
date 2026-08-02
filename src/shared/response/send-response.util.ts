import type { Response } from 'express';
import type {
  PaginatedResponse,
  PaginationMeta,
  SuccessResponse,
} from '@/shared/response/response-envelope';

/**
 * Four helpers, no more. Anything not covered here is rare enough that writing
 * `res.status(...).json(...)` at the call site is clearer than another wrapper.
 *
 * Error responses are deliberately absent: controllers throw, and the global
 * error handler is the only place that serialises a failure.
 */

export function sendSuccess<T>(res: Response, data: T, message?: string, statusCode = 200): void {
  const body: SuccessResponse<T> =
    message === undefined ? { success: true, data } : { success: true, message, data };
  res.status(statusCode).json(body);
}

export function sendCreated<T>(res: Response, data: T, message?: string): void {
  sendSuccess(res, data, message, 201);
}

export function sendPaginated<T>(
  res: Response,
  data: T[],
  meta: PaginationMeta,
  message?: string,
): void {
  const body: PaginatedResponse<T> =
    message === undefined ? { success: true, data, meta } : { success: true, message, data, meta };
  res.status(200).json(body);
}

/** 204 carries no body by definition — do not pass one. */
export function sendNoContent(res: Response): void {
  res.status(204).send();
}
