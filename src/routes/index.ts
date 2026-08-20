import { Router, type RequestHandler } from 'express';
import type { PrismaClientInstance } from '@/database/prisma';
import { API_BASE_PATH, SERVICE_NAME, SERVICE_VERSION } from '@/config/constants';
import { env } from '@/config/env';
import { createAuthenticate } from '@/middleware/authenticate.middleware';
import { createRequirePermission } from '@/middleware/authorize.middleware';

import { RbacRepository } from '@/modules/rbac/rbac.repository';
import { RbacService } from '@/modules/rbac/rbac.service';

import { UserRepository } from '@/modules/user/user.repository';
import { UserService } from '@/modules/user/user.service';
import { UserController } from '@/modules/user/user.controller';
import { createUserRouter } from '@/modules/user/user.routes';

import { AuthRepository } from '@/modules/auth/auth.repository';
import { AuthService } from '@/modules/auth/auth.service';
import { AuthController } from '@/modules/auth/auth.controller';
import { createAuthRouter } from '@/modules/auth/auth.routes';
import { ConsoleEmailService } from '@/modules/auth/email.service';

/**
 * ===========================================================================
 * Composition root
 * ===========================================================================
 * Every dependency in the application is constructed here, once, by hand.
 *
 * Why no DI container: with a handful of modules, a container replaces code you
 * can read with configuration you cannot. The wiring below states the entire
 * dependency graph in twenty lines — you can see that UserController has
 * exactly one dependency, and swapping ConsoleEmailService for a real transport
 * is a one-line change with a compiler error if the shape is wrong.
 *
 * The rule this file enforces: classes receive their collaborators through the
 * constructor and never import a singleton. That is what makes every service
 * unit-testable with a plain object stand-in.
 *
 * The API version prefix is applied here and only here. No module knows or
 * cares that it lives under /api/v1.
 */
export function createApiRouter(prisma: PrismaClientInstance): Router {
  // --- Infrastructure-facing services --------------------------------------
  const emailService = new ConsoleEmailService();

  // --- Repositories (persistence) ------------------------------------------
  const rbacRepository = new RbacRepository(prisma);
  const userRepository = new UserRepository(prisma);
  const authRepository = new AuthRepository(prisma);

  // --- Services (business logic) -------------------------------------------
  const rbacService = new RbacService(rbacRepository);
  const userService = new UserService(userRepository, rbacService);
  const authService = new AuthService(
    prisma,
    userRepository,
    authRepository,
    rbacService,
    emailService,
  );

  // --- Controllers (HTTP) ---------------------------------------------------
  const userController = new UserController(userService);
  const authController = new AuthController(authService);

  // --- Middleware that needs dependencies -----------------------------------
  // These are factories rather than plain middleware precisely so they can be
  // given a repository/service instead of importing one.
  const authenticate = createAuthenticate(userRepository);
  const requirePermission = createRequirePermission(rbacService) as (
    ...permissions: string[]
  ) => RequestHandler;

  // --- Routing --------------------------------------------------------------
  const apiRouter = Router();

  /** Service metadata. Deliberately says nothing about the deployment. */
  apiRouter.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        environment: env.NODE_ENV,
        documentation: '/api/docs',
      },
    });
  });

  apiRouter.use('/auth', createAuthRouter({ controller: authController, authenticate }));
  apiRouter.use(
    '/users',
    createUserRouter({ controller: userController, authenticate, requirePermission }),
  );

  // Mount the whole versioned surface under one prefix.
  const router = Router();
  router.use(API_BASE_PATH, apiRouter);

  return router;
}
