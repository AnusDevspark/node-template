import type { FieldError } from '@/errors';

/**
 * Every response this API produces has `success` at the top level. A client can
 * branch on that one field without inspecting the status code, which is what
 * makes a shared API client wrapper possible.
 */

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface SuccessResponse<T> {
  success: true;
  message?: string;
  data: T;
}

export interface PaginatedResponse<T> {
  success: true;
  message?: string;
  data: T[];
  meta: PaginationMeta;
}

export interface ErrorResponse {
  success: false;
  message: string;
  /** Present only where a client would branch on it. See ERROR_CODES. */
  code?: string;
  /** Present only on validation failures. */
  errors?: FieldError[];
  /** Echoed back so a user can quote it in a bug report. */
  requestId?: string;
}

export type ApiResponse<T> = SuccessResponse<T> | PaginatedResponse<T> | ErrorResponse;
