import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_BASE_PATH } from '@/config/constants';
import { UserStatus } from '@/generated/prisma/enums';
import { getTestApp } from '../helpers/test-app';
import { disconnectDatabase, resetDatabase } from '../helpers/database';
import { createTestUser, login } from '../helpers/auth';

/**
 * Auth flow against a real database and a real Express app.
 *
 * These are the tests that catch what unit tests cannot: middleware ordering,
 * the actual JSON envelope, database constraints, and the refresh-rotation
 * state machine.
 */
const app = getTestApp();
const AUTH = `${API_BASE_PATH}/auth`;

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('POST /auth/register', () => {
  it('creates an account and returns tokens', async () => {
    const response = await request(app)
      .post(`${AUTH}/register`)
      .send({
        firstName: 'New',
        lastName: 'Person',
        email: 'New.Person@Example.com',
        password: 'ValidPassword123',
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe('new.person@example.com'); // normalised
    expect(response.body.data.user.role).toBe('USER');
    expect(response.body.data.tokens.accessToken).toBeTruthy();
    expect(response.body.data.tokens.refreshToken).toBeTruthy();
  });

  it('never returns the password hash', async () => {
    const response = await request(app)
      .post(`${AUTH}/register`)
      .send({
        firstName: 'New',
        lastName: 'Person',
        email: 'hash.check@example.com',
        password: 'ValidPassword123',
      })
      .expect(201);

    // Check the whole serialised payload, not just the mapped field — this is
    // the assertion that catches a mapper being bypassed anywhere in the chain.
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('$argon2');
  });

  it('rejects a privilege-escalating role field', async () => {
    const response = await request(app)
      .post(`${AUTH}/register`)
      .send({
        firstName: 'Sneaky',
        lastName: 'User',
        email: 'sneaky@example.com',
        password: 'ValidPassword123',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      })
      .expect(201);

    // Zod strips unknown keys, so the injected role never reaches the service.
    expect(response.body.data.user.role).toBe('USER');
  });

  it('rejects a weak password with field errors', async () => {
    const response = await request(app)
      .post(`${AUTH}/register`)
      .send({ firstName: 'A', lastName: 'B', email: 'weak@example.com', password: 'short' })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.errors.some((e: { field: string }) => e.field === 'password')).toBe(true);
  });

  it('returns 409 for a duplicate email', async () => {
    await createTestUser({ email: 'taken@example.com' });

    const response = await request(app)
      .post(`${AUTH}/register`)
      .send({
        firstName: 'Dup',
        lastName: 'User',
        email: 'taken@example.com',
        password: 'ValidPassword123',
      })
      .expect(409);

    expect(response.body.code).toBe('CONFLICT');
  });
});

describe('POST /auth/login', () => {
  it('signs in with correct credentials', async () => {
    const user = await createTestUser({ email: 'login@example.com', password: 'MyPassword123' });

    const response = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: user.email, password: 'MyPassword123' })
      .expect(200);

    expect(response.body.data.tokens.tokenType).toBe('Bearer');
    expect(response.body.data.user.id).toBe(user.id);
  });

  it('returns an identical error for a wrong password and an unknown account', async () => {
    await createTestUser({ email: 'real@example.com', password: 'MyPassword123' });

    const wrongPassword = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: 'real@example.com', password: 'WrongPassword123' })
      .expect(401);

    const unknownAccount = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: 'ghost@example.com', password: 'WrongPassword123' })
      .expect(401);

    // Any difference here is an account-enumeration oracle.
    expect(wrongPassword.body.message).toBe(unknownAccount.body.message);
    expect(wrongPassword.body.code).toBe(unknownAccount.body.code);
    expect(wrongPassword.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('refuses a suspended account', async () => {
    const user = await createTestUser({
      email: 'suspended@example.com',
      password: 'MyPassword123',
      status: UserStatus.SUSPENDED,
    });

    const response = await request(app)
      .post(`${AUTH}/login`)
      .send({ email: user.email, password: 'MyPassword123' })
      .expect(401);

    expect(response.body.code).toBe('AUTH_ACCOUNT_DISABLED');
  });
});

describe('GET /auth/me', () => {
  it('returns the authenticated user', async () => {
    const user = await createTestUser({ email: 'me@example.com', password: 'MyPassword123' });
    const { accessToken } = await login(app, user.email, 'MyPassword123');

    const response = await request(app)
      .get(`${AUTH}/me`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data.email).toBe('me@example.com');
  });

  it('rejects a missing token', async () => {
    const response = await request(app).get(`${AUTH}/me`).expect(401);
    expect(response.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  it('rejects a malformed token', async () => {
    const response = await request(app)
      .get(`${AUTH}/me`)
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);

    expect(response.body.code).toBe('AUTH_TOKEN_INVALID');
  });
});

describe('POST /auth/refresh — rotation and reuse detection', () => {
  it('rotates the refresh token', async () => {
    const user = await createTestUser({ email: 'rotate@example.com', password: 'MyPassword123' });
    const { refreshToken } = await login(app, user.email, 'MyPassword123');

    const response = await request(app).post(`${AUTH}/refresh`).send({ refreshToken }).expect(200);

    expect(response.body.data.tokens.refreshToken).not.toBe(refreshToken);
    expect(response.body.data.tokens.accessToken).toBeTruthy();
  });

  it('rejects a refresh token that has already been rotated', async () => {
    const user = await createTestUser({ email: 'replay@example.com', password: 'MyPassword123' });
    const { refreshToken } = await login(app, user.email, 'MyPassword123');

    await request(app).post(`${AUTH}/refresh`).send({ refreshToken }).expect(200);

    const replay = await request(app).post(`${AUTH}/refresh`).send({ refreshToken }).expect(401);
    expect(replay.body.code).toBe('AUTH_SESSION_REVOKED');
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const user = await createTestUser({ email: 'family@example.com', password: 'MyPassword123' });
    const { refreshToken: first } = await login(app, user.email, 'MyPassword123');

    const rotated = await request(app)
      .post(`${AUTH}/refresh`)
      .send({ refreshToken: first })
      .expect(200);
    const second = rotated.body.data.tokens.refreshToken as string;

    // Replaying the old token means it was captured. We cannot tell whether the
    // attacker or the victim holds the successor, so both must die.
    await request(app).post(`${AUTH}/refresh`).send({ refreshToken: first }).expect(401);

    const successor = await request(app)
      .post(`${AUTH}/refresh`)
      .send({ refreshToken: second })
      .expect(401);

    expect(successor.body.code).toBe('AUTH_SESSION_REVOKED');
  });

  it('rejects an access token presented at the refresh endpoint', async () => {
    const user = await createTestUser({
      email: 'wrongtype@example.com',
      password: 'MyPassword123',
    });
    const { accessToken } = await login(app, user.email, 'MyPassword123');

    // The `type` claim is what stops this, independently of the separate secrets.
    const response = await request(app)
      .post(`${AUTH}/refresh`)
      .send({ refreshToken: accessToken })
      .expect(401);

    expect(response.body.code).toBe('AUTH_TOKEN_INVALID');
  });
});

describe('POST /auth/logout', () => {
  it('invalidates the refresh token', async () => {
    const user = await createTestUser({ email: 'logout@example.com', password: 'MyPassword123' });
    const { refreshToken } = await login(app, user.email, 'MyPassword123');

    await request(app).post(`${AUTH}/logout`).send({ refreshToken }).expect(204);

    await request(app).post(`${AUTH}/refresh`).send({ refreshToken }).expect(401);
  });

  it('succeeds for an unknown token without revealing anything', async () => {
    const user = await createTestUser({ email: 'unknown@example.com', password: 'MyPassword123' });
    const { refreshToken } = await login(app, user.email, 'MyPassword123');

    await request(app).post(`${AUTH}/logout`).send({ refreshToken }).expect(204);
    // Second logout of the same token is still a success.
    await request(app).post(`${AUTH}/logout`).send({ refreshToken }).expect(204);
  });
});

describe('POST /auth/change-password', () => {
  it('changes the password and revokes other sessions', async () => {
    const user = await createTestUser({ email: 'change@example.com', password: 'MyPassword123' });

    // Two devices signed in.
    const deviceA = await login(app, user.email, 'MyPassword123');
    const deviceB = await login(app, user.email, 'MyPassword123');

    await request(app)
      .post(`${AUTH}/change-password`)
      .set('Authorization', `Bearer ${deviceA.accessToken}`)
      .send({
        currentPassword: 'MyPassword123',
        newPassword: 'BrandNewPassword456',
        refreshToken: deviceA.refreshToken,
      })
      .expect(200);

    // The other device is signed out.
    await request(app)
      .post(`${AUTH}/refresh`)
      .send({ refreshToken: deviceB.refreshToken })
      .expect(401);

    // The device that made the change keeps working.
    await request(app)
      .post(`${AUTH}/refresh`)
      .send({ refreshToken: deviceA.refreshToken })
      .expect(200);

    // The new password works and the old one does not.
    await request(app)
      .post(`${AUTH}/login`)
      .send({ email: user.email, password: 'BrandNewPassword456' })
      .expect(200);

    await request(app)
      .post(`${AUTH}/login`)
      .send({ email: user.email, password: 'MyPassword123' })
      .expect(401);
  });

  it('rejects a wrong current password', async () => {
    const user = await createTestUser({ email: 'wrongcur@example.com', password: 'MyPassword123' });
    const { accessToken } = await login(app, user.email, 'MyPassword123');

    const response = await request(app)
      .post(`${AUTH}/change-password`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'NotMyPassword123', newPassword: 'BrandNewPassword456' })
      .expect(401);

    expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });
});
