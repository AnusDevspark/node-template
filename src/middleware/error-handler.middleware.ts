import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { Prisma } from '@/generated/prisma/client';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { AppError, ERROR_CODES, ValidationError, type FieldError } from '@/errors';
import { mapPrismaError } from '@/shared/utils/prisma-error-mapper.util';
import type { ErrorResponse } from '@/shared/response/response-envelope';

/**
 * The only place in the application that turns a failure into an HTTP response.
 *
 * Controllers throw and never build an error body. Express 5 forwards rejected
 * promises here automatically, so async handlers need no wrapper.
 *
 * It understands, in order: AppError (and every subclass), Zod errors that
 * escaped the validation middleware, JWT errors, Prisma errors, malformed JSON
 * from the body parser, payload-too-large, and finally anything unknown.
 */

/** Express's body-parser errors carry these extra properties. */
interface BodyParserError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    error instanceof Error && 'type' in error && typeof (error as BodyParserError).type === 'string'
  );
}

function zodIssuesToFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

/**
 * Normalises anything thrown into an AppError.
 * Returns the AppError plus the original error, so the caller can log the real
 * cause even when the client-facing error is a generic 500.
 */
function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  // A schema parsed outside the validation middleware (e.g. inside a service).
  if (error instanceof z.ZodError) {
    return new ValidationError('Validation failed', zodIssuesToFieldErrors(error));
  }

  // JWT failures raised outside the authenticate middleware.
  if (error instanceof TokenExpiredError) {
    return new AppError('Access token has expired', 401, { code: ERROR_CODES.AUTH_TOKEN_EXPIRED });
  }
  if (error instanceof JsonWebTokenError) {
    return new AppError('Invalid access token', 401, { code: ERROR_CODES.AUTH_TOKEN_INVALID });
  }

  // Prisma errors that a repository did not already translate.
  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientValidationError
  ) {
    const mapped = mapPrismaError(error);
    if (mapped instanceof AppError) return mapped;

    // An unmapped Prisma code is our bug: never expose the code to the client.
    return new AppError('Internal server error', 500, {
      code: ERROR_CODES.INTERNAL_ERROR,
      isOperational: false,
      cause: error,
    });
  }

  // Body parser: malformed JSON, or a payload over the configured limit.
  if (isBodyParserError(error)) {
    if (error.type === 'entity.parse.failed') {
      return new AppError('Malformed JSON in request body', 400, { code: ERROR_CODES.BAD_REQUEST });
    }
    if (error.type === 'entity.too.large') {
      return new AppError('Request body is too large', 413, { code: ERROR_CODES.BAD_REQUEST });
    }
  }

  // Unknown. Treated as a bug: logged with a stack, reported generically.
  return new AppError('Internal server error', 500, {
    code: ERROR_CODES.INTERNAL_ERROR,
    isOperational: false,
    cause: error,
  });
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Express delegates to its default handler if headers are already sent; there
  // is nothing useful we can add to a half-written response.
  if (res.headersSent) {
    next(error);
    return;
  }

  const appError = normalizeError(error);

  // Log level follows intent, not status: an expected 404 is not an incident,
  // an unexpected 500 always is.
  const logContext = {
    // pino-http types req.id as string | number; our middleware always sets a
    // string, but coerce so the response contract stays string-only.
    requestId: req.id === undefined ? undefined : String(req.id),
    method: req.method,
    path: req.originalUrl,
    statusCode: appError.statusCode,
    code: appError.code,
    userId: req.user?.id,
  };

  if (!appError.isOperational || appError.statusCode >= 500) {
    logger.error({ ...logContext, err: appError.cause ?? appError }, appError.message);
  } else if (appError.statusCode >= 400) {
    logger.warn(logContext, appError.message);
  }

  const body: ErrorResponse = {
    success: false,
    // A non-operational error's message may contain internals (a driver string,
    // a file path). In production it is replaced with a fixed message; in
    // development it is kept because that is what makes debugging possible.
    message:
      appError.isOperational || !env.isProduction ? appError.message : 'Internal server error',
  };

  if (appError.code) body.code = appError.code;
  if (appError.errors && appError.errors.length > 0) body.errors = appError.errors;
  if (req.id !== undefined) body.requestId = String(req.id);

  // Stack traces never leave the server in production.
  if (!env.isProduction && appError.stack) {
    (body as ErrorResponse & { stack?: string }).stack = appError.stack;
  }

  res.status(appError.statusCode).json(body);
}
