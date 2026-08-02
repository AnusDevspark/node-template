import type { SortOrder } from '@/shared/types/list-query.type';

/**
 * Turns `?sortBy=createdAt&sortOrder=desc` into a Prisma `orderBy` object —
 * but only for fields the calling module explicitly allows.
 *
 * The whitelist is the whole point. Passing a raw user string as a Prisma
 * `orderBy` key lets a caller sort by `passwordHash`, which leaks its ordering
 * and therefore information about the values. Every module declares its own
 * `*_SORT_FIELDS` tuple and this function refuses anything outside it.
 */
export function buildOrderBy<TField extends string>(
  allowedFields: readonly TField[],
  defaultField: TField,
  sortBy?: string,
  sortOrder: SortOrder = 'desc',
): Record<TField, SortOrder> {
  const field = allowedFields.includes(sortBy as TField) ? (sortBy as TField) : defaultField;
  const order: SortOrder = sortOrder === 'asc' ? 'asc' : 'desc';

  return { [field]: order } as Record<TField, SortOrder>;
}
