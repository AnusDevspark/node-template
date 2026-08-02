import type { UserResponse, UserWithRole } from '@/modules/user/user.types';

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
