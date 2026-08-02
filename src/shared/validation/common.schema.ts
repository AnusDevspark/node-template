import { z } from 'zod';
import { PAGINATION_DEFAULTS } from '@/shared/utils/pagination.util';
import { SORT_ORDERS } from '@/shared/types/list-query.type';
import { normalizeEmail, normalizeName, normalizeSearchTerm } from '@/shared/utils/normalize.util';

/**
 * Reusable Zod pieces for query strings and common fields.
 *
 * These are plain schemas and one small factory. There is deliberately no
 * generic "query schema builder" — modules compose these with `.extend()`,
 * which stays readable and keeps `z.infer` working without type gymnastics.
 */

/** Path parameter for any `/:id` route. Rejects a non-UUID before it reaches Prisma. */
export const uuidParamSchema = z.object({
  id: z.uuid('must be a valid UUID'),
});

/**
 * page / pageSize.
 *
 * `coerce` is required because query values arrive as strings. The max is
 * enforced here as well as in getPagination so an oversized request is a clear
 * 400 rather than a silent clamp.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION_DEFAULTS.PAGE),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(
      PAGINATION_DEFAULTS.MAX_PAGE_SIZE,
      `pageSize cannot exceed ${PAGINATION_DEFAULTS.MAX_PAGE_SIZE}`,
    )
    .default(PAGINATION_DEFAULTS.PAGE_SIZE),
});

/**
 * sortBy / sortOrder, restricted to the fields the calling module allows.
 *
 * The whitelist is passed in rather than inferred, so an unknown `sortBy` is
 * rejected with a helpful message instead of silently falling back.
 */
export function sortingSchema<const TFields extends readonly [string, ...string[]]>(
  allowedFields: TFields,
  defaultField: TFields[number],
) {
  return z.object({
    sortBy: z.enum(allowedFields).default(defaultField),
    sortOrder: z.enum(SORT_ORDERS).default('desc'),
  });
}

/** Free-text search term, normalised and length-capped. */
export const searchSchema = z.object({
  search: z
    .string()
    .trim()
    .max(200, 'search term is too long')
    .transform(normalizeSearchTerm)
    .optional(),
});

/**
 * Query-string booleans. `?isActive=true` arrives as the string "true", and
 * plain `z.boolean()` would reject it.
 */
export const booleanQueryParam = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Email, normalised to lowercase so lookups and the unique index agree. */
export const emailSchema = z
  .email('must be a valid email address')
  .trim()
  .min(1, 'email is required')
  .max(255)
  .transform(normalizeEmail);

/**
 * Password policy for new passwords.
 *
 * Length is the requirement that actually matters; composition rules mostly
 * push users toward predictable substitutions. A 10-character floor with one
 * letter and one digit is a reasonable compromise that will not surprise anyone.
 * The upper bound exists because Argon2 hashing cost scales with input length —
 * an unbounded password is a cheap denial-of-service vector.
 */
export const passwordSchema = z
  .string()
  .min(10, 'password must be at least 10 characters')
  .max(128, 'password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'password must contain at least one letter')
  .regex(/\d/, 'password must contain at least one number');

/** Person name field: trimmed and whitespace-collapsed. */
export const personNameSchema = z
  .string()
  .trim()
  .min(1, 'is required')
  .max(100, 'must be at most 100 characters')
  .transform(normalizeName);
