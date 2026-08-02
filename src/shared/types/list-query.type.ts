/** Shared shapes for the list-endpoint pipeline (pagination + sorting + search). */

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** What a validated list query looks like after Zod parsing. */
export interface ListQuery {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: SortOrder;
  search?: string;
}

/** What `getPagination` hands to a repository. */
export interface PaginationParams {
  skip: number;
  take: number;
  page: number;
  pageSize: number;
}

/** What every repository `findMany` returns, so services can page uniformly. */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
}
