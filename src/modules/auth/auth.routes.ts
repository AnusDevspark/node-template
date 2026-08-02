import { Router, type RequestHandler } from 'express';
import { validate } from '@/middleware/validate.middleware';
import { authLimiter } from '@/middleware/rate-limit.middleware';
import type { AuthController } from '@/modules/auth/auth.controller';
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
} from '@/modules/auth/auth.schema';

export interface AuthRouteDependencies {
  controller: AuthController;
  authenticate: RequestHandler;
}

/**
 * Auth routes.
 *
 * The credential endpoints carry the strict rate limiter; `/me` does not,
 * because it is an ordinary authenticated read and throttling it would break
 * apps that call it on every page load.
 */
export function createAuthRouter({ controller, authenticate }: AuthRouteDependencies): Router {
  const router = Router();

  router.post('/register', authLimiter, validate({ body: registerSchema }), controller.register);

  router.post('/login', authLimiter, validate({ body: loginSchema }), controller.login);

  // Rate limited too: an attacker holding a stolen refresh token would otherwise
  // be free to mint access tokens continuously.
  router.post('/refresh', authLimiter, validate({ body: refreshSchema }), controller.refresh);

  // No authenticate middleware: logging out with an expired access token must
  // still work, and the refresh token in the body is the credential here.
  router.post('/logout', validate({ body: logoutSchema }), controller.logout);

  router.get('/me', authenticate, controller.me);

  router.post(
    '/change-password',
    authenticate,
    authLimiter,
    validate({ body: changePasswordSchema }),
    controller.changePassword,
  );

  return router;
}
