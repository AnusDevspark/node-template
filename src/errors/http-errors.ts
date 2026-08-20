import { AppError, ERROR_CODES, type ErrorCode, type FieldError } from '@/errors/app-error';

/**
 * The concrete errors application code throws.
 *
 * Each one owns exactly one HTTP status. Controllers and services never build an
 * error response by hand — they throw one of these and the global error handler
 * turns it into the standard envelope.
 */

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code: ErrorCode = ERROR_CODES.BAD_REQUEST) {
    super(message, 400, { code });
  }
}

/**
 * Field-level validation failure. Status is 400, not 422.
 *
 * The convention here is: 400 for every malformed or rejected request body,
 * including semantic validation. 422 is defensible but splits clients' error
 * handling across two codes for no practical gain, so this template uses one.
 */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', errors: FieldError[] = []) {
    super(message, 400, { code: ERROR_CODES.VALIDATION_FAILED, errors });
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message = 'Authentication required',
    code: ErrorCode = ERROR_CODES.AUTH_TOKEN_INVALID,
  ) {
    super(message, 401, { code });
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'You do not have access to this resource',
    code: ErrorCode = ERROR_CODES.FORBIDDEN,
  ) {
    super(message, 403, { code });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, { code: ERROR_CODES.NOT_FOUND });
  }
}

/**
 * A uniqueness or state conflict, e.g. an email already registered.
 *
 * `field` is optional but worth passing whenever the conflict is *about* one:
 * it produces the same `errors: [{ field, message }]` array a validation failure
 * does, which is what lets a client drop the message next to the offending input
 * instead of showing a detached banner. "This email is already in use" belongs
 * under the email box.
 */
export class ConflictError extends AppError {
  constructor(message = 'Resource already exists', field?: string) {
    super(message, 409, {
      code: ERROR_CODES.CONFLICT,
      ...(field ? { errors: [{ field, message }] } : {}),
    });
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests, please try again later') {
    super(message, 429, { code: ERROR_CODES.RATE_LIMITED });
  }
}

/**
 * Thrown for genuinely unexpected failures. `isOperational` is false, so the
 * error handler logs it with a full stack and never echoes `message` to the
 * client in production.
 */
export class InternalServerError extends AppError {
  constructor(message = 'Internal server error', cause?: unknown) {
    super(message, 500, {
      code: ERROR_CODES.INTERNAL_ERROR,
      isOperational: false,
      cause,
    });
  }
}
