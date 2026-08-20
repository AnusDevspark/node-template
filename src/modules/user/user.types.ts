import type { UserStatus } from '@/generated/prisma/enums';

/**
 * Types the user module exposes to the rest of the application.
 *
 * These are hand-written rather than re-exported Prisma model types on purpose:
 * the Prisma type includes `passwordHash`, and a module that hands that shape to
 * a caller invites it into a response by accident.
 */

/** Safe representation returned by the API. Note the absence of passwordHash. */
export interface UserResponse {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  status: UserStatus;
  role: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The signed-in user's own view of themselves, returned by /auth/login,
 * /auth/register, /auth/refresh and /auth/me.
 *
 * It carries `permissions` because a frontend needs them to decide what to
 * render — which links to show, which buttons to disable. That is UX only; the
 * API re-checks every permission on every request regardless of what the client
 * believes. Permissions are resolved from the role at request time rather than
 * stored on the user, so revoking one takes effect without re-issuing a token.
 *
 * Deliberately NOT part of `UserResponse`: /users list and detail describe other
 * people, and one user's permission set is not another user's business.
 */
export interface SessionUserResponse extends UserResponse {
  permissions: string[];
}

/** What the repository returns for a full read — internal to the module. */
export interface UserWithRole {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
  roleId: string;
  role: { id: string; name: string };
  createdAt: Date;
  updatedAt: Date;
}

/** Minimal shape the authenticate middleware needs on every request. */
export interface UserAuthContext {
  id: string;
  email: string;
  status: UserStatus;
  role: { name: string };
}

/** Explicitly whitelisted fields the repository will write on create. */
export interface CreateUserData {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  roleId: string;
  status?: UserStatus;
}

/** Explicitly whitelisted fields the repository will write on update. */
export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  email?: string;
  status?: UserStatus;
  roleId?: string;
  passwordHash?: string;
}

export interface UserListFilters {
  search?: string;
  status?: UserStatus;
  role?: string;
}
