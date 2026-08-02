import type { PaginationMeta } from '@/shared/response/response-envelope';
import type { PaginationParams } from '@/shared/types/list-query.type';

/**
 * Pagination defaults. The maximum matters: without it a client can ask for
 * `pageSize=1000000` and turn a cheap endpoint into a full table scan that
 * exhausts the connection pool. The Zod schema clamps it too, but the clamp
 * lives here as well so a repository called from a non-HTTP path stays bounded.
 */
export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

export function getPagination(query: { page?: number; pageSize?: number }): PaginationParams {
  const page = Math.max(1, Math.trunc(query.page ?? PAGINATION_DEFAULTS.PAGE));
  const requested = Math.trunc(query.pageSize ?? PAGINATION_DEFAULTS.PAGE_SIZE);
  const pageSize = Math.min(Math.max(1, requested), PAGINATION_DEFAULTS.MAX_PAGE_SIZE);

  return {
    skip: (page - 1) * pageSize,
    take: pageSize,
    page,
    pageSize,
  };
}

export function buildPaginationMeta(
  total: number,
  { page, pageSize }: Pick<PaginationParams, 'page' | 'pageSize'>,
): PaginationMeta {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;

  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && total > 0,
  };
}
