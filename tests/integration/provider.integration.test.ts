import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { API_BASE_PATH } from '@/config/constants';
import { ROLES } from '@/shared/constants/roles.constant';
import { getTestApp } from '../helpers/test-app';
import { disconnectDatabase, prisma, resetDatabase } from '../helpers/database';
import { authenticatedRequest } from '../helpers/auth';

const app = getTestApp();
const PROVIDERS = `${API_BASE_PATH}/providers`;

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

async function seedProviders(): Promise<void> {
  await prisma.provider.createMany({
    data: [
      {
        firstName: 'Ada',
        lastName: 'Okafor',
        dateOfBirth: new Date('1981-03-14T00:00:00Z'),
        email: 'ada@example.com',
        speciality: 'Cardiology',
        isActive: true,
      },
      {
        firstName: 'John',
        lastName: 'Mercer',
        dateOfBirth: new Date('1975-11-02T00:00:00Z'),
        email: 'john@example.com',
        speciality: 'Cardiology',
        isActive: true,
      },
      {
        firstName: 'Priya',
        lastName: 'Raman',
        dateOfBirth: new Date('1988-07-21T00:00:00Z'),
        email: 'priya@example.com',
        speciality: 'Neurology',
        isActive: true,
      },
      {
        firstName: 'Tomas',
        lastName: 'Lindqvist',
        dateOfBirth: new Date('1969-01-30T00:00:00Z'),
        email: 'tomas@example.com',
        speciality: 'Orthopaedics',
        isActive: false,
      },
    ],
  });
}

describe('Provider authorization', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await request(app).get(PROVIDERS).expect(401);
    expect(response.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  it('lets a standard USER read providers', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });
    await request(app).get(PROVIDERS).set(headers).expect(200);
  });

  it('forbids a standard USER from creating a provider', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.USER });

    const response = await request(app)
      .post(PROVIDERS)
      .set(headers)
      .send({
        firstName: 'New',
        lastName: 'Provider',
        dateOfBirth: '1990-01-01',
        email: 'new@example.com',
        speciality: 'Cardiology',
      })
      .expect(403);

    expect(response.body.code).toBe('PERMISSION_DENIED');
  });

  it('forbids a standard USER from deleting a provider', async () => {
    await seedProviders();
    const provider = await prisma.provider.findFirstOrThrow();
    const { headers } = await authenticatedRequest({ role: ROLES.USER });

    await request(app).delete(`${PROVIDERS}/${provider.id}`).set(headers).expect(403);
  });
});

describe('POST /providers', () => {
  it('creates a provider for an ADMIN', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const response = await request(app)
      .post(PROVIDERS)
      .set(headers)
      .send({
        firstName: '  Ada  ',
        lastName: 'Okafor',
        dateOfBirth: '1981-03-14',
        email: 'Ada.Okafor@Example.com',
        speciality: 'Cardiology',
      })
      .expect(201);

    expect(response.body.data.firstName).toBe('Ada'); // trimmed
    expect(response.body.data.email).toBe('ada.okafor@example.com'); // lowercased
    expect(response.body.data.dateOfBirth).toBe('1981-03-14'); // date-only, no drift
    expect(response.body.data.isActive).toBe(true); // schema default
  });

  it('returns 409 on a duplicate email', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    const body = {
      firstName: 'Ada',
      lastName: 'Okafor',
      dateOfBirth: '1981-03-14',
      email: 'dupe@example.com',
      speciality: 'Cardiology',
    };

    await request(app).post(PROVIDERS).set(headers).send(body).expect(201);

    const response = await request(app).post(PROVIDERS).set(headers).send(body).expect(409);
    expect(response.body.code).toBe('CONFLICT');
  });

  it('ignores fields that are not in the schema', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const response = await request(app)
      .post(PROVIDERS)
      .set(headers)
      .send({
        firstName: 'Mass',
        lastName: 'Assignment',
        dateOfBirth: '1990-01-01',
        email: 'mass@example.com',
        speciality: 'Cardiology',
        id: '00000000-0000-4000-8000-000000000000',
        createdAt: '1999-01-01T00:00:00.000Z',
      })
      .expect(201);

    expect(response.body.data.id).not.toBe('00000000-0000-4000-8000-000000000000');
    expect(response.body.data.createdAt).not.toContain('1999');
  });

  it('rejects an invalid body with per-field errors', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const response = await request(app)
      .post(PROVIDERS)
      .set(headers)
      .send({ firstName: '', dateOfBirth: '2099-01-01', email: 'nope', speciality: '' })
      .expect(400);

    const fields = response.body.errors.map((e: { field: string }) => e.field);
    expect(fields).toContain('firstName');
    expect(fields).toContain('email');
    expect(fields).toContain('dateOfBirth');
  });
});

describe('GET /providers — pagination, filtering, sorting, search', () => {
  it('paginates with correct metadata', async () => {
    await seedProviders();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const response = await request(app)
      .get(`${PROVIDERS}?page=2&pageSize=2`)
      .set(headers)
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta).toEqual({
      page: 2,
      pageSize: 2,
      total: 4,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });

  it('searches case-insensitively across name and email', async () => {
    await seedProviders();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const response = await request(app).get(`${PROVIDERS}?search=JOHN`).set(headers).expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].firstName).toBe('John');
  });

  it('filters by isActive and speciality', async () => {
    await seedProviders();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const inactive = await request(app).get(`${PROVIDERS}?isActive=false`).set(headers).expect(200);
    expect(inactive.body.data).toHaveLength(1);
    expect(inactive.body.data[0].lastName).toBe('Lindqvist');

    const cardio = await request(app)
      .get(`${PROVIDERS}?speciality=Cardiology`)
      .set(headers)
      .expect(200);
    expect(cardio.body.data).toHaveLength(2);
  });

  it('sorts by a whitelisted field', async () => {
    await seedProviders();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const response = await request(app)
      .get(`${PROVIDERS}?sortBy=lastName&sortOrder=asc`)
      .set(headers)
      .expect(200);

    const lastNames = response.body.data.map((p: { lastName: string }) => p.lastName);
    expect(lastNames).toEqual(['Lindqvist', 'Mercer', 'Okafor', 'Raman']);
  });

  it('rejects a sort field that is not whitelisted', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    // Without the whitelist this would order by a column the caller cannot read.
    const response = await request(app).get(`${PROVIDERS}?sortBy=id`).set(headers).expect(400);
    expect(response.body.errors[0].field).toBe('sortBy');
  });

  it('rejects a pageSize above the maximum', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const response = await request(app)
      .get(`${PROVIDERS}?pageSize=100000`)
      .set(headers)
      .expect(400);
    expect(response.body.errors[0].field).toBe('pageSize');
  });
});

describe('GET /providers/active', () => {
  it('returns only active providers and is not matched as /:id', async () => {
    await seedProviders();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const response = await request(app).get(`${PROVIDERS}/active`).set(headers).expect(200);

    expect(response.body.data).toHaveLength(3);
    expect(response.body.data.every((p: { isActive: boolean }) => p.isActive)).toBe(true);
  });
});

describe('POST /providers/import — transaction rollback', () => {
  const rows = [
    {
      firstName: 'One',
      lastName: 'Alpha',
      dateOfBirth: '1990-01-01',
      email: 'one@example.com',
      speciality: 'Cardiology',
    },
    {
      firstName: 'Two',
      lastName: 'Beta',
      dateOfBirth: '1991-02-02',
      email: 'two@example.com',
      speciality: 'Neurology',
    },
  ];

  it('imports a whole batch atomically', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const response = await request(app)
      .post(`${PROVIDERS}/import`)
      .set(headers)
      .send({ providers: rows })
      .expect(201);

    expect(response.body.data).toHaveLength(2);
    expect(await prisma.provider.count()).toBe(2);
  });

  it('rolls the entire batch back when one row conflicts', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    // Pre-existing row that the second import entry will collide with.
    await request(app).post(PROVIDERS).set(headers).send(rows[1]).expect(201);
    expect(await prisma.provider.count()).toBe(1);

    await request(app)
      .post(`${PROVIDERS}/import`)
      .set(headers)
      .send({ providers: rows })
      .expect(409);

    // The first entry was valid and was written inside the transaction — it
    // must be gone. A count of 2 here would mean a partial import.
    expect(await prisma.provider.count()).toBe(1);
    expect(await prisma.provider.findUnique({ where: { email: 'one@example.com' } })).toBeNull();
  });

  it('rejects duplicate emails within the payload itself', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    await request(app)
      .post(`${PROVIDERS}/import`)
      .set(headers)
      .send({ providers: [rows[0], rows[0]] })
      .expect(409);

    expect(await prisma.provider.count()).toBe(0);
  });

  it('rejects an empty batch', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    await request(app).post(`${PROVIDERS}/import`).set(headers).send({ providers: [] }).expect(400);
  });
});

describe('GET /providers/:id', () => {
  it('returns a provider', async () => {
    await seedProviders();
    const existing = await prisma.provider.findFirstOrThrow();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const response = await request(app).get(`${PROVIDERS}/${existing.id}`).set(headers).expect(200);
    expect(response.body.data.id).toBe(existing.id);
  });

  it('returns 404 for a valid but unknown id', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const response = await request(app)
      .get(`${PROVIDERS}/11111111-1111-4111-8111-111111111111`)
      .set(headers)
      .expect(404);

    expect(response.body.message).toBe('Provider not found');
  });

  it('returns 400 for a malformed id', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });
    await request(app).get(`${PROVIDERS}/not-a-uuid`).set(headers).expect(400);
  });
});

describe('PATCH and DELETE /providers/:id', () => {
  it('updates a provider', async () => {
    await seedProviders();
    const existing = await prisma.provider.findFirstOrThrow();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const response = await request(app)
      .patch(`${PROVIDERS}/${existing.id}`)
      .set(headers)
      .send({ speciality: 'Neurology', isActive: false })
      .expect(200);

    expect(response.body.data.speciality).toBe('Neurology');
    expect(response.body.data.isActive).toBe(false);
  });

  it('rejects an empty update body', async () => {
    await seedProviders();
    const existing = await prisma.provider.findFirstOrThrow();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    await request(app).patch(`${PROVIDERS}/${existing.id}`).set(headers).send({}).expect(400);
  });

  it('deletes a provider and returns 204', async () => {
    await seedProviders();
    const existing = await prisma.provider.findFirstOrThrow();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    await request(app).delete(`${PROVIDERS}/${existing.id}`).set(headers).expect(204);

    // Hard delete: the row is gone, not flagged.
    expect(await prisma.provider.findUnique({ where: { id: existing.id } })).toBeNull();
  });

  it('returns 404 when deleting an unknown provider', async () => {
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    await request(app)
      .delete(`${PROVIDERS}/11111111-1111-4111-8111-111111111111`)
      .set(headers)
      .expect(404);
  });
});
