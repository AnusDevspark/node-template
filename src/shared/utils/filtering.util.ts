/**
 * Search helper for list endpoints.
 *
 * Case-insensitivity: Prisma's `mode: 'insensitive'` compiles to Postgres
 * `ILIKE`. That is correct but *unindexed* — a btree index on `lastName` cannot
 * serve `ILIKE '%john%'`, so this is a sequential scan on large tables. It is
 * the right default for a starter (no extensions, no migration complexity); the
 * upgrade when search volume grows is a `pg_trgm` GIN index, or a dedicated
 * tsvector column for real full-text search. Documented in docs/architecture.md.
 *
 * Filtering itself is deliberately NOT generic. Each module builds its own
 * `where` object from its own validated fields — a generic filter builder would
 * have to accept arbitrary keys, which is exactly the mass-assignment hole we
 * are trying to close.
 */

export interface InsensitiveContains {
  contains: string;
  mode: 'insensitive';
}

/**
 * Builds an OR clause across the given fields for a search term.
 * Returns undefined when there is nothing to search, so the caller can spread it
 * into a `where` object without producing an empty `OR: []` (which matches nothing).
 */
export function buildSearchFilter<TField extends string>(
  fields: readonly TField[],
  search?: string,
): { OR: Record<TField, InsensitiveContains>[] } | undefined {
  const term = search?.trim();
  if (!term || fields.length === 0) return undefined;

  return {
    OR: fields.map(
      (field) =>
        ({ [field]: { contains: term, mode: 'insensitive' } }) as Record<
          TField,
          InsensitiveContains
        >,
    ),
  };
}

/**
 * Drops keys whose value is undefined so an optional filter that was not
 * supplied does not become `where: { isActive: undefined }`.
 *
 * Prisma treats an explicit `undefined` as "ignore this", so this is defensive
 * rather than load-bearing — but it keeps logged queries readable.
 */
export function omitUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      result[key as keyof T] = value as T[keyof T];
    }
  }
  return result;
}
