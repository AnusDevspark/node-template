import { Router, type RequestHandler } from 'express';
import { validate } from '@/middleware/validate.middleware';
import { PERMISSIONS } from '@/shared/constants/permissions.constant';
import type { UserController } from '@/modules/user/user.controller';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  userIdParamSchema,
} from '@/modules/user/user.schema';

export interface UserRouteDependencies {
  controller: UserController;
  authenticate: RequestHandler;
  requirePermission: (...permissions: string[]) => RequestHandler;
}

/**
 * Routes declare the middleware chain and nothing else: no business logic, no
 * inline handlers. The order is deliberate and is the same everywhere —
 * authenticate, then authorize, then validate, then the controller.
 *
 * The path prefix is absent on purpose: `/api/v1/users` is composed once in
 * src/routes/index.ts, so this router can be mounted anywhere.
 */
export function createUserRouter({
  controller,
  authenticate,
  requirePermission,
}: UserRouteDependencies): Router {
  const router = Router();

  // Every user endpoint requires a valid session.
  router.use(authenticate);

  router.get(
    '/',
    requirePermission(PERMISSIONS.USER_VIEW),
    validate({ query: listUsersQuerySchema }),
    controller.listUsers,
  );

  router.post(
    '/',
    requirePermission(PERMISSIONS.USER_CREATE),
    validate({ body: createUserSchema }),
    controller.createUser,
  );

  router.get(
    '/:id',
    requirePermission(PERMISSIONS.USER_VIEW),
    validate({ params: userIdParamSchema }),
    controller.getUser,
  );

  // No permission gate here: a user may edit their own profile without
  // USER_EDIT. The service enforces that ownership rule, because only it knows
  // which record is being touched.
  router.patch(
    '/:id',
    validate({ params: userIdParamSchema, body: updateUserSchema }),
    controller.updateUser,
  );

  router.delete(
    '/:id',
    requirePermission(PERMISSIONS.USER_DELETE),
    validate({ params: userIdParamSchema }),
    controller.deleteUser,
  );

  return router;
}
