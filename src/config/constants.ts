/**
 * Values that are referenced from more than one place and would be a bug if they
 * drifted apart. Single-use literals stay at their call site on purpose — a
 * constant that is read once is indirection, not clarity.
 */

/** Mounted once, in src/routes/index.ts. Modules never hardcode the prefix. */
export const API_PREFIX = '/api';
export const API_VERSION = 'v1';
export const API_BASE_PATH = `${API_PREFIX}/${API_VERSION}`;

export const DOCS_PATH = `${API_PREFIX}/docs`;

export const HEADERS = {
  /** Read from the incoming request if present, otherwise generated. */
  REQUEST_ID: 'x-request-id',
  AUTHORIZATION: 'authorization',
} as const;

export const AUTH_SCHEME = 'Bearer';

export const SERVICE_NAME = 'node-backend-template';
export const SERVICE_VERSION = '1.0.0';
