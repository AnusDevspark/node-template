import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODES, ForbiddenError } from '@/errors';
import { requireAuthenticatedUser } from '@/shared/utils/auth-context.util';
import type { PermissionKey } from '@/shared/constants/permissions.constant';
import type { RoleName } from '@/shared/constants/roles.constant';
import type { RbacService } from '@/modules/rbac/rbac.service';

/**
 * "Are you allowed to do this?" — authorization, kept separate from
 * authentication. Both of these assume `authenticate` already ran; each throws
 * 401 rather than 403 if it did not, because an unauthenticated caller is not
 * forbidden, they are unidentified.
 */

/**
 * Coarse role gate.
 *
 * Useful for whole-surface restrictions ("this router is admin-only"). Prefer
 * requirePermission for anything finer: a role check hardcodes policy into the
 * code, whereas a permission check leaves policy in the database where an
 * operator can change it.
 */
export function authorizeRoles(...allowedRoles: readonly (RoleName | string)[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const user = requireAuthenticatedUser(req);

      if (!allowedRoles.includes(user.role)) {
        throw new ForbiddenError('You do not have access to this resource', ERROR_CODES.FORBIDDEN);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Fine-grained permission gate. This is the one to reach for by default.
 *
 *   router.post('/', authenticate, requirePermission(PERMISSIONS.PROVIDER_CREATE), handler)
 *
 * Grants are read through RbacService, which caches them briefly, so the common
 * case costs no database round trip.
 */
export function createRequirePermission(rbacService: RbacService) {
  return function requirePermission(...required: readonly PermissionKey[]): RequestHandler {
    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
      try {
        const user = requireAuthenticatedUser(req);

        // All required permissions must be held — the strict reading, which is
        // the safe default. Use requireAnyPermission where either will do.
        const allowed = await rbacService.hasAllPermissions(user.role, required);

        if (!allowed) {
          throw new ForbiddenError(
            'You do not have permission to perform this action',
            ERROR_CODES.PERMISSION_DENIED,
          );
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  };
}

/** Same as above but satisfied by any one of the listed permissions. */
export function createRequireAnyPermission(rbacService: RbacService) {
  return function requireAnyPermission(...required: readonly PermissionKey[]): RequestHandler {
    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
      try {
        const user = requireAuthenticatedUser(req);
        const allowed = await rbacService.hasAnyPermission(user.role, required);

        if (!allowed) {
          throw new ForbiddenError(
            'You do not have permission to perform this action',
            ERROR_CODES.PERMISSION_DENIED,
          );
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  };
}
