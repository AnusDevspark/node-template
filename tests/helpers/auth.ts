import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '@/database/prisma';
import { API_BASE_PATH } from '@/config/constants';
import { hashPassword } from '@/shared/utils/password.util';
import { signAccessToken } from '@/shared/utils/jwt.util';
import { ROLES } from '@/shared/constants/roles.constant';
import type { UserStatus } from '@/generated/prisma/enums';

/**
 * Helpers for authenticating in tests.
 *
 * Only what the tests actually need. There is no `TestUserBuilder` DSL — an
 * options object with defaults reads better than a fluent chain, and the point
 * of a test helper is to make the test's intent obvious, not to be clever.
 */

export interface TestUserOptions {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  status?: UserStatus;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: string;
}

/** Creates a user directly in the database, bypassing the HTTP layer. */
export async function createTestUser(options: TestUserOptions = {}): Promise<TestUser> {
  const email =
    options.email ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = options.password ?? 'TestPassword123';
  const roleName = options.role ?? ROLES.USER;

  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new Error(`Role ${roleName} not found — call resetDatabase() first`);
  }

  const user = await prisma.user.create({
    data: {
      firstName: options.firstName ?? 'Test',
      lastName: options.lastName ?? 'User',
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      roleId: role.id,
      ...(options.status ? { status: options.status } : {}),
    },
  });

  return { id: user.id, email: user.email, password, role: roleName };
}

/**
 * Signs an access token without going through login.
 *
 * Use this when a test needs an authenticated caller but is not testing the
 * login flow itself — it skips an Argon2 verification per test.
 */
export function generateTestToken(user: { id: string; email: string; role: string }): string {
  return signAccessToken({ sub: user.id, email: user.email, role: user.role });
}

/** Full login round trip, for tests that care about the real token pair. */
export async function login(
  app: Express,
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await request(app)
    .post(`${API_BASE_PATH}/auth/login`)
    .send({ email, password })
    .expect(200);

  return {
    accessToken: response.body.data.tokens.accessToken,
    refreshToken: response.body.data.tokens.refreshToken,
  };
}

/**
 * Creates a user and returns a ready-to-use bearer header.
 *
 *   const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
 *   await request(app).get('/api/v1/users').set(headers).expect(200);
 */
export async function authenticatedRequest(
  options: TestUserOptions = {},
): Promise<{ user: TestUser; token: string; headers: Record<string, string> }> {
  const user = await createTestUser(options);
  const token = generateTestToken(user);

  return {
    user,
    token,
    headers: { Authorization: `Bearer ${token}` },
  };
}
