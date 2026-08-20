import { Prisma } from '@/generated/prisma/client';
import { AppError, BadRequestError, ConflictError, NotFoundError } from '@/errors';

/**
 * Translates Prisma's error codes into application errors.
 *
 * Two reasons this exists. First, leaking `P2002` and a constraint name to a
 * client exposes the database schema. Second, the *useful* HTTP status depends
 * on the Prisma code, and that mapping should live in one place rather than in
 * every repository's catch block.
 *
 * Reference: https://www.prisma.io/docs/orm/reference/error-reference
 */

/** Pulls the offending column names out of a P2002 meta payload. */
function extractTargetFields(meta: unknown): string[] {
  if (meta && typeof meta === 'object' && 'target' in meta) {
    const target = (meta as { target?: unknown }).target;
    if (Array.isArray(target)) return target.filter((t): t is string => typeof t === 'string');
    if (typeof target === 'string') return [target];
  }
  return [];
}

/**
 * Maps a caught error to an AppError, or returns it unchanged if it is already
 * one (so a ConflictError thrown by a service passes straight through).
 *
 * @param resourceName Used to build a readable message, e.g. "Provider".
 */
export function mapPrismaError(error: unknown, resourceName = 'Resource'): unknown {
  if (error instanceof AppError) return error;

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      // Unique constraint violation.
      case 'P2002': {
        const fields = extractTargetFields(error.meta);
        const detail = fields.length > 0 ? ` with this ${fields.join(', ')}` : '';
        // Postgres names the offending column, so pass it along as the field —
        // that is what puts "already exists" next to the right input instead of
        // in a detached banner. Composite constraints name several; the first is
        // the one a form can usefully highlight.
        return new ConflictError(`${resourceName}${detail} already exists`, fields[0]);
      }

      // An operation (update/delete) targeted a row that does not exist.
      case 'P2025':
        return new NotFoundError(`${resourceName} not found`);

      // Foreign key constraint failed — the client referenced something absent.
      case 'P2003':
        return new BadRequestError(
          `Related record referenced by this ${resourceName} does not exist`,
        );

      // Required relation violation: deleting would orphan dependent rows.
      case 'P2014':
        return new ConflictError(
          `This ${resourceName} is referenced by other records and cannot be modified`,
        );

      // Value too long for the column.
      case 'P2000':
        return new BadRequestError('One of the provided values is too long');

      default:
        // Anything else is a bug or an unhandled case: fall through so the global
        // handler logs it with a stack and returns a generic 500.
        return error;
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    // Reaching this means our own query construction is wrong, not the client's.
    return error;
  }

  return error;
}

/**
 * Convenience wrapper for repository methods.
 *
 * Usage: `return withPrismaErrors('Provider', () => this.prisma.provider.create(...))`
 */
export async function withPrismaErrors<T>(
  resourceName: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapPrismaError(error, resourceName);
  }
}
