/**
 * Role names.
 *
 * Roles live in the database (the `roles` table) so an operator can create new
 * ones and remap permissions without a deploy. This constant mirrors the rows
 * the seed creates, and exists so application code can reference a known role by
 * name without a magic string. A role added at runtime simply will not appear
 * here — that is fine, because code should branch on *permissions*, not roles.
 */
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  SUPER_ADMIN: 'Full access, including role and permission management',
  ADMIN: 'Manages users and business resources',
  USER: 'Standard authenticated account',
};
