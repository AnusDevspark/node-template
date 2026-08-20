import type {
  SessionUserResponse,
  UserResponse,
  UserWithRole,
} from '@/modules/user/user.types';

/**
 * Database entity → API DTO.
 *
 * This is the enforcement point for "passwordHash never leaves the server". A
 * Prisma record is never returned directly from a controller; it goes through
 * here first, and this function builds its output field by field rather than
 * spreading the input. Spreading would silently leak any column added to the
 * table later — including the next sensitive one.
 */
export function mapUserToResponse(user: UserWithRole): UserResponse {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`,
    email: user.email,
    status: user.status,
    role: user.role.name,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function mapUsersToResponse(users: UserWithRole[]): UserResponse[] {
  return users.map(mapUserToResponse);
}

/**
 * The same DTO plus the caller's own permission keys.
 *
 * Permissions arrive as an argument rather than being read here because they
 * come from the role, not the user row — the mapper stays a pure shape
 * transform and the caller owns the lookup (and its cache).
 */
export function mapUserToSessionResponse(
  user: UserWithRole,
  permissions: Iterable<string>,
): SessionUserResponse {
  return {
    ...mapUserToResponse(user),
    // Sorted so the payload is stable between requests — it makes responses
    // diffable in tests and cache-friendly.
    permissions: [...permissions].sort(),
  };
}
