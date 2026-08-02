import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UserStatus } from '@/generated/prisma/enums';
import { ERROR_CODES, UnauthorizedError } from '@/errors';
import { extractBearerToken, verifyAccessToken } from '@/shared/utils/jwt.util';
import type { UserRepository } from '@/modules/user/user.repository';

/**
 * "Who are you?" — authentication only. Authorization lives in separate
 * middleware so the two questions never get tangled.
 *
 * Design decision: this hits the database on every authenticated request to
 * re-check account status. A pure-JWT check would be one signature verification
 * with no I/O, but it means a user you just suspended keeps full access until
 * their access token expires. Fifteen minutes of access for a suspended or
 * deleted account is not acceptable, and the lookup is a single indexed
 * primary-key read. If you later need to remove it, shorten the access token
 * lifetime to compensate.
 *
 * The role is re-read from the database rather than trusted from the token, for
 * the same reason: a demoted user must lose access immediately.
 */
export function createAuthenticate(userRepository: UserRepository): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = extractBearerToken(req.get('authorization'));

      if (!token) {
        throw new UnauthorizedError('Authentication required', ERROR_CODES.AUTH_TOKEN_MISSING);
      }

      // Throws UnauthorizedError with a distinct code for expired vs invalid.
      const payload = verifyAccessToken(token);

      const user = await userRepository.findAuthContextById(payload.sub);

      if (!user) {
        // The token is valid but the account is gone. Same response as an
        // invalid token — we do not confirm that an id once existed.
        throw new UnauthorizedError('Invalid access token', ERROR_CODES.AUTH_TOKEN_INVALID);
      }

      if (user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedError(
          'This account is not active. Contact an administrator.',
          ERROR_CODES.AUTH_ACCOUNT_DISABLED,
        );
      }

      req.user = {
        id: user.id,
        email: user.email,
        role: user.role.name,
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Attaches `req.user` when a valid token is present and does nothing otherwise.
 *
 * For endpoints that return richer data to a signed-in caller but stay public —
 * never for endpoints that must be protected.
 */
export function createOptionalAuthenticate(userRepository: UserRepository): RequestHandler {
  const authenticate = createAuthenticate(userRepository);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!extractBearerToken(req.get('authorization'))) {
      next();
      return;
    }

    authenticate(req, res, next);
  };
}
