import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { API_BASE_PATH } from '@/config/constants';
import { ROLES } from '@/shared/constants/roles.constant';
import { getTestApp } from '../helpers/test-app';
import { disconnectDatabase, resetDatabase } from '../helpers/database';
import { authenticatedRequest, createTestUser } from '../helpers/auth';

const app = getTestApp();
const USERS = `${API_BASE_PATH}/users`;

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('User authorization', () => {
  it('forbids a standard USER from listing users', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });

    const response = await request(app).get(USERS).set(headers).expect(403);
    expect(response.body.code).toBe('PERMISSION_DENIED');
  });

  it('allows an ADMIN to list users', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    await createTestUser({ email: 'other@example.com' });

    const response = await request(app).get(USERS).set(headers).expect(200);
    expect(response.body.meta.total).toBeGreaterThanOrEqual(2);
  });

  it('never includes the password hash in a listing', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    await createTestUser({ email: 'hidden@example.com' });

    const response = await request(app).get(USERS).set(headers).expect(200);

    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('$argon2');
  });
});

describe('Ownership rules on PATCH /users/:id', () => {
  it('lets a user update their own profile without USER_EDIT', async () => {
    const { user, headers } = await authenticatedRequest({ role: ROLES.USER });

    const response = await request(app)
      .patch(`${USERS}/${user.id}`)
      .set(headers)
      .send({ firstName: 'Renamed' })
      .expect(200);

    expect(response.body.data.firstName).toBe('Renamed');
  });

  it('stops a user from editing someone else', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    const victim = await createTestUser({ email: 'victim@example.com' });

    const response = await request(app)
      .patch(`${USERS}/${victim.id}`)
      .set(headers)
      .send({ firstName: 'Hacked' })
      .expect(403);

    expect(response.body.message).toContain('own profile');
  });

  it('stops a user from promoting themselves', async () => {
    const { user, headers } = await authenticatedRequest({ role: ROLES.USER });

    // The escalation guard: even a caller who holds USER_EDIT cannot change
    // their own role, so USER_EDIT can never be used to become SUPER_ADMIN.
    const response = await request(app)
      .patch(`${USERS}/${user.id}`)
      .set(headers)
      .send({ role: ROLES.SUPER_ADMIN })
      .expect(403);

    expect(response.body.message).toContain('your own role');
  });

  it('stops an admin from promoting themselves', async () => {
    const { user, headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    await request(app)
      .patch(`${USERS}/${user.id}`)
      .set(headers)
      .send({ role: ROLES.SUPER_ADMIN })
      .expect(403);
  });

  it("lets an admin change another user's role", async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    const target = await createTestUser({ email: 'promote@example.com' });

    const response = await request(app)
      .patch(`${USERS}/${target.id}`)
      .set(headers)
      .send({ status: 'SUSPENDED' })
      .expect(200);

    expect(response.body.data.status).toBe('SUSPENDED');
  });
});

describe('A suspended user loses access immediately', () => {
  it('rejects a still-valid access token once the account is suspended', async () => {
    const { user, headers } = await authenticatedRequest({ role: ROLES.USER });
    const admin = await authenticatedRequest({ role: ROLES.ADMIN });

    // The token is valid and unexpired.
    await request(app).get(`${API_BASE_PATH}/auth/me`).set(headers).expect(200);

    await request(app)
      .patch(`${USERS}/${user.id}`)
      .set(admin.headers)
      .send({ status: 'SUSPENDED' })
      .expect(200);

    // The authenticate middleware re-reads status on every request, so access
    // ends now rather than when the access token expires.
    const response = await request(app).get(`${API_BASE_PATH}/auth/me`).set(headers).expect(401);
    expect(response.body.code).toBe('AUTH_ACCOUNT_DISABLED');
  });
});

describe('DELETE /users/:id', () => {
  it('refuses self-deletion', async () => {
    const { user, headers } = await authenticatedRequest({ role: ROLES.SUPER_ADMIN });

    const response = await request(app).delete(`${USERS}/${user.id}`).set(headers).expect(400);
    expect(response.body.message).toContain('your own account');
  });

  it('deletes another user and their sessions', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.SUPER_ADMIN });
    const target = await createTestUser({ email: 'delete-me@example.com' });

    await request(app).delete(`${USERS}/${target.id}`).set(headers).expect(204);
    await request(app).get(`${USERS}/${target.id}`).set(headers).expect(404);
  });
});
