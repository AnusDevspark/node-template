/**
 * Import errors from here: `import { NotFoundError } from '@/errors';`
 *
 * The plan called for one file per error class. They are five lines each and
 * always change together, so they live in one file — eight files would be
 * ceremony, not organisation.
 */
export { AppError, ERROR_CODES, type ErrorCode, type FieldError } from '@/errors/app-error';
export {
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
  InternalServerError,
} from '@/errors/http-errors';
