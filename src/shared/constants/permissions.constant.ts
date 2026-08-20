import { ROLES, type RoleName } from '@/shared/constants/roles.constant';

/**
 * Permission keys.
 *
 * Naming is RESOURCE_ACTION. Application code always checks a permission, never
 * a role — that is what lets an operator invent a "SUPPORT" role that can view
 * users but not delete them, with no code change.
 *
 * Where the source of truth lives: the *keys* are here in code because they are
 * referenced by `requirePermission(PERMISSIONS.PROVIDER_CREATE)` at call sites
 * and must be typo-proof. The *grants* — which role has which permission — live
 * in the database, because that is the part operators need to change at runtime.
 * The map below is only the seed's starting point, not the runtime authority.
 */
export const PERMISSIONS = {
  USER_VIEW: 'USER_VIEW',
  USER_CREATE: 'USER_CREATE',
  USER_EDIT: 'USER_EDIT',
  USER_DELETE: 'USER_DELETE',

  ROLE_MANAGE: 'ROLE_MANAGE',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  USER_VIEW: 'List and read user accounts',
  USER_CREATE: 'Create user accounts',
  USER_EDIT: 'Modify user accounts',
  USER_DELETE: 'Delete user accounts',
  ROLE_MANAGE: 'Create roles and change their permissions',
};

/**
 * Initial grants applied by `npm run prisma:seed`.
 *
 * Seeding only *adds* the rows it declares; it never deletes grants an operator
 * made by hand, so re-running the seed after a permission change is safe.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, PermissionKey[]> = {
  [ROLES.SUPER_ADMIN]: ALL_PERMISSIONS,
  // An admin manages people but cannot delete them or reshape the role system —
  // those stay with SUPER_ADMIN.
  [ROLES.ADMIN]: [PERMISSIONS.USER_VIEW, PERMISSIONS.USER_CREATE, PERMISSIONS.USER_EDIT],
  // A standard user holds no permissions at all. That is not an oversight:
  // editing their *own* profile is an ownership rule enforced in UserService,
  // not a permission. See docs/architecture.md on role vs ownership
  // authorization. Grant this role whatever your domain's read permissions turn
  // out to be.
  [ROLES.USER]: [],
};
