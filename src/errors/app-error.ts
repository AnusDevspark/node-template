/**
 * Machine-readable error codes.
 *
 * Tradeoff: a code is genuinely useful when a client must *branch* on the error
 * — showing a "resend verification" button for AUTH_EMAIL_NOT_VERIFIED, or
 * silently refreshing on AUTH_TOKEN_EXPIRED. It is dead weight when the client
 * would only ever display `message`. So this enum covers auth and a few generic
 * cases, and domain errors are free to omit a code and pass only a message.
 * Adding one later is backwards compatible; clients that ignore it are unaffected.
 */
export const ERROR_CODES = {
  // Generic
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** A dependency is down. Emitted by the health endpoints; retry is sensible. */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Authentication — the client behaves differently for each of these.
  AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_ACCOUNT_DISABLED: 'AUTH_ACCOUNT_DISABLED',
  AUTH_SESSION_REVOKED: 'AUTH_SESSION_REVOKED',

  // Authorization
  FORBIDDEN: 'FORBIDDEN',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** One field-level validation failure, as returned in the `errors` array. */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * Base class for every error this application throws on purpose.
 *
 * `isOperational` is the important distinction: an operational error is an
 * expected outcome of a valid request (not found, conflict, bad credentials) and
 * is safe to show the client. Anything else is a bug, gets logged at error level
 * with a stack, and is reported to the client as a generic 500.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode | undefined;
  public readonly isOperational: boolean;
  public readonly errors: FieldError[] | undefined;

  constructor(
    message: string,
    statusCode: number,
    options: {
      code?: ErrorCode;
      errors?: FieldError[];
      isOperational?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);

    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = options.code;
    this.errors = options.errors;
    this.isOperational = options.isOperational ?? true;

    Error.captureStackTrace?.(this, new.target);
  }
}
