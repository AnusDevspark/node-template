# Testing

```bash
npm test                  # unit — no database, ~300ms
npm run test:watch        # unit, watch mode
npm run test:coverage     # unit + coverage report
npm run test:integration  # real Postgres + real Express
```

The template ships **11 unit** and **56 integration** tests, all passing on a fresh clone.

---

## The split

|          | Unit                | Integration                       |
| -------- | ------------------- | --------------------------------- |
| Location | `tests/unit/`       | `tests/integration/`              |
| Config   | `vitest.config.mts` | `vitest.integration.config.mts`   |
| Database | None                | Real Postgres (`app_test`)        |
| Speed    | ~300ms              | ~14s                              |
| Tests    | Business rules      | Wiring, middleware, HTTP contract |

**Rules → unit. Wiring → integration.**

---

## Unit tests

A service takes its collaborators through the constructor and never imports a singleton, so a plain object of `vi.fn()`s is a complete stand-in.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserService } from '@/modules/user/user.service';
import { ConflictError } from '@/errors';

function createMockRepository() {
  return {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  };
}

describe('UserService', () => {
  let repository: ReturnType<typeof createMockRepository>;
  let service: UserService;

  beforeEach(() => {
    repository = createMockRepository();
    const prisma = { $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({})) };
    service = new UserService(repository as never, prisma as never);
  });

  it('throws ConflictError when the email is taken', async () => {
    repository.findByEmail.mockResolvedValue({ id: 'existing' });

    await expect(service.createUser(input)).rejects.toThrow(ConflictError);
    expect(repository.create).not.toHaveBeenCalled(); // rejected before any write
  });
});
```

Points worth copying:

- **Mock only what the service calls.** A mock mirroring the whole repository is a maintenance cost.
- **Assert the negative.** `expect(repository.create).not.toHaveBeenCalled()` proves the rule fired _before_ the write, which is what actually matters.
- **`restoreMocks: true`** is set in the config, so no manual cleanup between tests.
- **Inspect the arguments** to prove field whitelisting:

```ts
const written = repository.create.mock.calls[0]?.[0] as Record<string, unknown>;
expect(written['id']).toBeUndefined();
```

---

## Integration tests

These drive the real app through Supertest — no port is bound, so they never collide with a running dev server.

```ts
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { API_BASE_PATH } from '@/config/constants';
import { ROLES } from '@/shared/constants/roles.constant';
import { getTestApp } from '../helpers/test-app';
import { disconnectDatabase, prisma, resetDatabase } from '../helpers/database';
import { authenticatedRequest } from '../helpers/auth';

const app = getTestApp();

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

it('forbids a standard USER from creating a user', async () => {
  const { headers } = await authenticatedRequest({ role: ROLES.USER });

  const response = await request(app)
    .post(`${API_BASE_PATH}/users`)
    .set(headers)
    .send({/* … */})
    .expect(403);

  expect(response.body.code).toBe('PERMISSION_DENIED');
});
```

### Helpers

| Helper                          | Does                                                  |
| ------------------------------- | ----------------------------------------------------- |
| `getTestApp()`                  | The Express app, built once                           |
| `resetDatabase()`               | Truncates every table, re-seeds roles and permissions |
| `createTestUser(options)`       | Inserts a user directly, bypassing HTTP               |
| `generateTestToken(user)`       | Signs an access token without a login round trip      |
| `login(app, email, password)`   | Full login, returns both tokens                       |
| `authenticatedRequest(options)` | Creates a user and returns ready-to-use `headers`     |

`authenticatedRequest` is what most tests want:

```ts
const { user, token, headers } = await authenticatedRequest({ role: ROLES.ADMIN });
await request(app).get('/api/v1/users').set(headers).expect(200);
```

Use `login()` only when the login flow itself is under test — it costs an Argon2 verification.

---

## The test database

`TEST_DATABASE_URL` must differ from `DATABASE_URL`. Two guards enforce it:

- `tests/setup/integration.setup.ts` throws if they match or if it is unset.
- `scripts/reset-test-db.ts` refuses to migrate.

The setup file swaps `DATABASE_URL` **before anything imports the app**, because `src/config/env.ts` reads `process.env` at import time.

`npm run test:integration` runs `pretest:integration` first, which applies migrations to `app_test` via `prisma migrate deploy`.

### Reset strategy

`TRUNCATE ... RESTART IDENTITY CASCADE` between tests, then re-seed roles and permissions.

Why not the alternatives:

- **`deleteMany`** — much slower, and you must order it around foreign keys.
- **Drop and recreate the schema** — a migration run per test.
- **Transaction per test, rolled back** — fastest, but the app opens its own transactions and nesting changes the behaviour under test.

**When you add a model, add its table to `TABLES` in `tests/helpers/database.ts`** or rows will leak between tests:

```ts
const TABLES = [
  'refresh_sessions',
  'role_permissions',
  'users',
  'permissions',
  'roles',
];
```

### Sequential by design

`fileParallelism: false` — files share one database and truncate it. If the suite grows large enough for this to hurt, give each worker its own Postgres schema rather than reintroducing shared-state races.

### Rate limits are raised

The suite generates many deliberate 401s; under the production limit of 10 failures per window it would throttle itself and later tests would fail with unrelated 429s. `integration.setup.ts` raises the limits. Rate limiting deserves its own focused test, not incidental coverage.

---

## What is worth testing

From the existing suite:

| Test                                                              | Why it earns its place                          |
| ----------------------------------------------------------------- | ----------------------------------------------- |
| Wrong password and unknown account return **identical** responses | Any difference is an enumeration oracle         |
| `JSON.stringify(body)` contains no `passwordHash` or `$argon2`    | Catches a bypassed mapper anywhere in the chain |
| Replaying a rotated refresh token revokes the whole family        | The core of the theft response                  |
| An access token is rejected at `/auth/refresh`                    | Proves the `type` claim check works             |
| Injected `role` / `id` fields are ignored                         | Mass assignment                                 |
| `sortBy=id` returns 400                                           | The sort whitelist                              |
| A mid-batch import failure rolls everything back                  | The transaction actually rolls back             |
| A suspended user's valid token stops working                      | Status is re-checked per request                |

Pattern: **test the security property, not the happy path.** The happy path breaks loudly; these fail silently.

---

## Adding tests for a new module

1. Add the table to `TABLES` in `tests/helpers/database.ts`.
2. Unit test the service's rules with mocked repositories.
3. Integration test: permission denials, validation, the happy path, and any state machine.

```bash
npx vitest run tests/unit/user.service.test.ts
npx vitest run --config vitest.integration.config.mts -t "double-book"
```

---

## Coverage

```bash
npm run test:coverage
```

Covers `src/**`, excluding generated Prisma code, `routes/` and `docs/` (wiring, exercised by the integration suite) and `server.ts`.

No threshold is enforced. Coverage finds untested code; it does not tell you the tested code is correct. The security tests above are worth more than ten points of line coverage.
