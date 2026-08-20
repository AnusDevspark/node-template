import { z } from 'zod';
import { createDocument } from 'zod-openapi';
import { API_BASE_PATH, SERVICE_NAME, SERVICE_VERSION } from '@/config/constants';
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
} from '@/modules/auth/auth.schema';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  userIdParamSchema,
} from '@/modules/user/user.schema';

/**
 * ===========================================================================
 * OpenAPI document
 * ===========================================================================
 * Generated from the *same* Zod schemas the validation middleware uses.
 *
 * The alternative — hand-written JSDoc annotations or a separate YAML file — is
 * two definitions of every request shape that drift apart silently. Here, adding
 * a required field to `createUserSchema` changes the validation and the
 * documentation in the same commit, because they are the same object.
 *
 * `zod-openapi` was chosen over `@asteasolutions/zod-to-openapi` because it
 * supports Zod 4 without patching Zod's prototype (`extendZodWithOpenApi`).
 *
 * What is still written by hand: paths, status codes and descriptions. That is
 * inherent — a schema describes a shape, not an endpoint's meaning.
 */

// --- Reusable response shapes ---------------------------------------------

const errorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  code: z.string().optional(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  requestId: z.string().optional(),
});

const paginationMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});

const userResponseSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  email: z.email(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']),
  role: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * What the caller gets back about *themselves*. Identical to userResponseSchema
 * plus the permission keys their role grants, which a client needs to decide
 * what to render. /users never returns this — see SessionUserResponse.
 */
const sessionUserResponseSchema = userResponseSchema.extend({
  permissions: z.array(z.string()),
});

const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  tokenType: z.literal('Bearer'),
});

const authResultSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  data: z.object({ user: sessionUserResponseSchema, tokens: authTokensSchema }),
});

/** Wraps a payload schema in the standard success envelope. */
function successOf<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    message: z.string().optional(),
    data: dataSchema,
  });
}

/** Wraps a payload schema in the standard paginated envelope. */
function paginatedOf<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    success: z.literal(true),
    data: z.array(itemSchema),
    meta: paginationMetaSchema,
  });
}

/** The error responses nearly every endpoint can produce. */
const commonErrors = {
  '400': {
    description: 'Validation failed or malformed request',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  '401': {
    description: 'Missing, invalid or expired access token',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  '403': {
    description: 'Authenticated but lacking the required permission',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  '429': {
    description: 'Rate limit exceeded',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  '500': {
    description: 'Unexpected server error',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
} as const;

const notFoundResponse = {
  '404': {
    description: 'Resource not found',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
} as const;

const conflictResponse = {
  '409': {
    description: 'Resource already exists',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
} as const;

const bearerAuth = [{ bearerAuth: [] }];

export function buildOpenApiDocument(): ReturnType<typeof createDocument> {
  return createDocument({
    openapi: '3.1.0',
    info: {
      title: `${SERVICE_NAME} API`,
      version: SERVICE_VERSION,
      description: [
        'Production-ready modular-monolith backend template.',
        '',
        '## Authentication',
        'Send the access token as `Authorization: Bearer <accessToken>`.',
        'Access tokens are short-lived (15 minutes by default). When one expires,',
        'call `POST /auth/refresh` with the refresh token to obtain a new pair.',
        '',
        '**Refresh tokens rotate.** Every refresh invalidates the token you sent.',
        'Presenting an already-used refresh token is treated as theft and revokes',
        'the entire session family, forcing a fresh login.',
        '',
        '## Errors',
        'Every failure returns `{ success: false, message, code?, errors?, requestId? }`.',
        'Validation failures always use **400** (this API does not use 422).',
      ].join('\n'),
    },
    servers: [{ url: API_BASE_PATH, description: 'Current version' }],
    tags: [
      { name: 'Auth', description: 'Registration, login, token lifecycle' },
      { name: 'Users', description: 'User administration (permission gated)' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token returned by /auth/login or /auth/refresh',
        },
      },
    },

    paths: {
      // ---------------------------------------------------------------- Auth
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Create an account',
          description:
            'Self-service signup. Always creates a standard USER — role cannot be set by the client.',
          requestBody: { content: { 'application/json': { schema: registerSchema } } },
          responses: {
            '201': {
              description: 'Account created, tokens issued',
              content: { 'application/json': { schema: authResultSchema } },
            },
            ...conflictResponse,
            ...commonErrors,
          },
        },
      },

      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Sign in',
          description:
            'Returns an access/refresh token pair. Invalid email and invalid password produce an identical response to prevent account enumeration.',
          requestBody: { content: { 'application/json': { schema: loginSchema } } },
          responses: {
            '200': {
              description: 'Signed in',
              content: { 'application/json': { schema: authResultSchema } },
            },
            ...commonErrors,
          },
        },
      },

      '/auth/refresh': {
        post: {
          tags: ['Auth'],
          summary: 'Rotate the refresh token',
          description:
            'Issues a new token pair and invalidates the refresh token supplied. Reusing a rotated token revokes every session in its family.',
          requestBody: { content: { 'application/json': { schema: refreshSchema } } },
          responses: {
            '200': {
              description: 'New token pair issued',
              content: { 'application/json': { schema: authResultSchema } },
            },
            ...commonErrors,
          },
        },
      },

      '/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'Sign out',
          description:
            'Revokes the supplied refresh token, or every session for the user when allDevices is true. Succeeds even if the token is already invalid.',
          requestBody: { content: { 'application/json': { schema: logoutSchema } } },
          responses: {
            '204': { description: 'Signed out' },
            ...commonErrors,
          },
        },
      },

      '/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Current user profile',
          description:
            'Returns the caller plus the permission keys their role grants. Clients use those keys for rendering decisions only — every endpoint re-checks permissions server-side.',
          security: bearerAuth,
          responses: {
            '200': {
              description: 'The authenticated user and their permissions',
              content: { 'application/json': { schema: successOf(sessionUserResponseSchema) } },
            },
            ...commonErrors,
          },
        },
      },

      '/auth/change-password': {
        post: {
          tags: ['Auth'],
          summary: 'Change password',
          description:
            'Requires the current password. Revokes all other sessions; pass the current refreshToken to keep this device signed in.',
          security: bearerAuth,
          requestBody: { content: { 'application/json': { schema: changePasswordSchema } } },
          responses: {
            '200': {
              description: 'Password changed',
              content: { 'application/json': { schema: successOf(z.null()) } },
            },
            ...commonErrors,
          },
        },
      },

      // --------------------------------------------------------------- Users
      '/users': {
        get: {
          tags: ['Users'],
          summary: 'List users',
          description: 'Requires USER_VIEW.',
          security: bearerAuth,
          requestParams: { query: listUsersQuerySchema },
          responses: {
            '200': {
              description: 'Paginated users',
              content: { 'application/json': { schema: paginatedOf(userResponseSchema) } },
            },
            ...commonErrors,
          },
        },
        post: {
          tags: ['Users'],
          summary: 'Create a user',
          description: 'Requires USER_CREATE.',
          security: bearerAuth,
          requestBody: { content: { 'application/json': { schema: createUserSchema } } },
          responses: {
            '201': {
              description: 'User created',
              content: { 'application/json': { schema: successOf(userResponseSchema) } },
            },
            ...conflictResponse,
            ...commonErrors,
          },
        },
      },

      '/users/{id}': {
        get: {
          tags: ['Users'],
          summary: 'Get a user',
          description: 'Requires USER_VIEW.',
          security: bearerAuth,
          requestParams: { path: userIdParamSchema },
          responses: {
            '200': {
              description: 'The user',
              content: { 'application/json': { schema: successOf(userResponseSchema) } },
            },
            ...notFoundResponse,
            ...commonErrors,
          },
        },
        patch: {
          tags: ['Users'],
          summary: 'Update a user',
          description:
            'A user may update their own profile without USER_EDIT, but may never change their own role or status.',
          security: bearerAuth,
          requestParams: { path: userIdParamSchema },
          requestBody: { content: { 'application/json': { schema: updateUserSchema } } },
          responses: {
            '200': {
              description: 'Updated user',
              content: { 'application/json': { schema: successOf(userResponseSchema) } },
            },
            ...notFoundResponse,
            ...conflictResponse,
            ...commonErrors,
          },
        },
        delete: {
          tags: ['Users'],
          summary: 'Delete a user',
          description: 'Requires USER_DELETE. You cannot delete your own account.',
          security: bearerAuth,
          requestParams: { path: userIdParamSchema },
          responses: {
            '204': { description: 'Deleted' },
            ...notFoundResponse,
            ...commonErrors,
          },
        },
      },
    },
  });
}
