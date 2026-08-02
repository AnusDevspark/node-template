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

  PROVIDER_VIEW: 'PROVIDER_VIEW',
  PROVIDER_CREATE: 'PROVIDER_CREATE',
  PROVIDER_EDIT: 'PROVIDER_EDIT',
  PROVIDER_DELETE: 'PROVIDER_DELETE',

  ROLE_MANAGE: 'ROLE_MANAGE',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  USER_VIEW: 'List and read user accounts',
  USER_CREATE: 'Create user accounts',
  USER_EDIT: 'Modify user accounts',
  USER_DELETE: 'Delete user accounts',
  PROVIDER_VIEW: 'List and read providers',
  PROVIDER_CREATE: 'Create providers',
  PROVIDER_EDIT: 'Modify providers',
  PROVIDER_DELETE: 'Delete providers',
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
  [ROLES.ADMIN]: [
    PERMISSIONS.USER_VIEW,
    PERMISSIONS.USER_CREATE,
    PERMISSIONS.USER_EDIT,
    PERMISSIONS.PROVIDER_VIEW,
    PERMISSIONS.PROVIDER_CREATE,
    PERMISSIONS.PROVIDER_EDIT,
    PERMISSIONS.PROVIDER_DELETE,
  ],
  // A standard user can read providers and nothing else. Editing their *own*
  // profile is not a permission — it is an ownership rule, enforced in
  // UserService. See docs/architecture.md on role vs ownership authorization.
  [ROLES.USER]: [PERMISSIONS.PROVIDER_VIEW],
};
