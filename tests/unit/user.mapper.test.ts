import { describe, expect, it } from 'vitest';
import { UserStatus } from '@/generated/prisma/enums';
import { mapUserToResponse, mapUserToSessionResponse } from '@/modules/user/user.mapper';
import type { UserWithRole } from '@/modules/user/user.types';

/**
 * The mapper is the enforcement point for "passwordHash never leaves the
 * server", so it gets a test that fails loudly if someone rewrites it as a
 * spread. The rest of the assertions pin the wire format the frontend template
 * mirrors by hand — see API-CONTRACT.md.
 */

function makeUser(overrides: Partial<UserWithRole> = {}): UserWithRole {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    firstName: 'Ada',
    lastName: 'Okafor',
    email: 'ada.okafor@example.com',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    status: UserStatus.ACTIVE,
    roleId: '22222222-2222-4222-8222-222222222222',
    role: { id: '22222222-2222-4222-8222-222222222222', name: 'ADMIN' },
    createdAt: new Date('2026-01-02T03:04:05.678Z'),
    updatedAt: new Date('2026-02-03T04:05:06.789Z'),
    ...overrides,
  };
}

describe('mapUserToResponse', () => {
  it('never emits passwordHash', () => {
    const result = mapUserToResponse(makeUser());

    expect(result).not.toHaveProperty('passwordHash');
    expect(Object.values(result)).not.toContain(makeUser().passwordHash);
  });

  it('emits exactly the documented fields', () => {
    expect(Object.keys(mapUserToResponse(makeUser())).sort()).toEqual([
      'createdAt',
      'email',
      'firstName',
      'fullName',
      'id',
      'lastName',
      'role',
      'status',
      'updatedAt',
    ]);
  });

  it('serialises dates as ISO-8601 strings and the role as its name', () => {
    const result = mapUserToResponse(makeUser());

    expect(result.createdAt).toBe('2026-01-02T03:04:05.678Z');
    expect(result.updatedAt).toBe('2026-02-03T04:05:06.789Z');
    // A name, not the role object or its id — clients compare against
    // PERMISSIONS/ROLES string constants.
    expect(result.role).toBe('ADMIN');
  });

  it('derives fullName from the two name parts', () => {
    expect(mapUserToResponse(makeUser()).fullName).toBe('Ada Okafor');
  });
});

describe('mapUserToSessionResponse', () => {
  it('adds permissions to the standard user shape', () => {
    const result = mapUserToSessionResponse(makeUser(), ['USER_VIEW', 'USER_CREATE']);

    expect(result.email).toBe('ada.okafor@example.com');
    expect(result.permissions).toEqual(['USER_CREATE', 'USER_VIEW']);
  });

  it('sorts permissions so the payload is stable between requests', () => {
    const first = mapUserToSessionResponse(makeUser(), new Set(['USER_VIEW', 'ROLE_MANAGE']));
    const second = mapUserToSessionResponse(makeUser(), new Set(['ROLE_MANAGE', 'USER_VIEW']));

    expect(first.permissions).toEqual(second.permissions);
  });

  it('accepts a Set, which is what RbacService returns', () => {
    const result = mapUserToSessionResponse(makeUser(), new Set(['USER_VIEW']));

    expect(result.permissions).toEqual(['USER_VIEW']);
  });

  it('emits an empty array for a role with no grants, never undefined', () => {
    // The USER role seeds with zero permissions; the frontend narrows on an
    // array, so this must not become `undefined`.
    expect(mapUserToSessionResponse(makeUser(), []).permissions).toEqual([]);
  });

  it('still never emits passwordHash', () => {
    expect(mapUserToSessionResponse(makeUser(), ['USER_VIEW'])).not.toHaveProperty('passwordHash');
  });
});
