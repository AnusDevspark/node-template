# Troubleshooting

Real failures seen while building and running this template, and what they actually mean.

---

## Setup

### `npm install` fails building a native module

You are probably not on this template's `@node-rs/argon2` — the older `argon2` package compiles C++ through node-gyp and needs Python plus a toolchain:

```
gyp ERR! find Python ... Could not find any Python installation to use
```

This template uses `@node-rs/argon2`, which ships prebuilt binaries for every platform including Alpine/musl. If you swapped it, either install a build toolchain or swap back.

### `Cannot find module '@/generated/prisma/client'`

The Prisma client has not been generated. It is TypeScript source under `src/generated/`, git-ignored, and produced by:

```bash
npm run prisma:generate
```

`postinstall` runs this automatically, so a bare `npm install` normally suffices. You need it manually after editing `prisma/schema.prisma`.

### `Invalid environment configuration` on startup

Working as designed — the process refuses to boot rather than half-run. The message names each variable:

```
Invalid environment configuration:
  - JWT_ACCESS_SECRET: JWT_ACCESS_SECRET must be at least 32 characters
```

```bash
cp .env.example .env
echo "JWT_ACCESS_SECRET=$(openssl rand -base64 48)"
```

---

## Database

### `Can't reach database server at localhost:5432`

```bash
docker compose ps          # is it running?
docker compose up -d postgres
npm run db:wait            # blocks until it actually accepts connections
```

`docker compose up -d` returns as soon as the container _starts_, which is before Postgres finishes initialising. That gap is why `db:wait` exists.

### Postgres container restarts forever

```
Error: in 18+, these Docker images are configured to store database data in a
format which is compatible with "pg_ctlcluster" ...
```

Postgres 18 changed the volume convention: mount `/var/lib/postgresql`, **not** `/var/lib/postgresql/data`. This template's compose file is already correct — you hit this if you have an old volume from a pre-18 image:

```bash
docker compose down -v     # destroys the volume and its data
docker compose up -d postgres
```

### `relation "..." does not exist`

Migrations have not been applied to the database you are pointed at.

```bash
npm run prisma:migrate                # development
npx tsx scripts/reset-test-db.ts      # the test database
```

If integration tests raise it, `pretest:integration` should have handled it — run it manually to see the real error.

### `The migration ... found in the database but not in the migrations folder`

A migration was applied, then its folder was deleted. Prisma refuses to guess.

```bash
npx prisma migrate reset   # development only — destroys all data
```

For a database you care about, restore the folder from git instead.

### Migration wants to drop a column you did not touch

Your local schema drifted from the migration history — usually from `prisma db push` on a project that uses migrations. Reset in development. In production, never apply a migration you have not read.

---

## Authentication

### Every request returns 401 `AUTH_TOKEN_MISSING`

The header must be exactly:

```
Authorization: Bearer <accessToken>
```

Common mistakes: sending the **refresh** token, `Bearer` misspelled or absent, or a shell variable that did not expand. Verify:

```bash
curl -v localhost:3000/api/v1/auth/me -H "Authorization: Bearer $TOKEN" 2>&1 | grep -i authorization
```

### 401 `AUTH_TOKEN_EXPIRED`

Access tokens live 15 minutes by default. This is the code your client should treat as "silently refresh", as distinct from `AUTH_TOKEN_INVALID`, which means "log out".

### 401 `AUTH_SESSION_REVOKED` and I did nothing wrong

A refresh token was presented **after** it had already been rotated. The template treats that as theft and revokes the entire session family.

Legitimate causes:

- Two tabs or two threads refreshing concurrently — one wins, the other replays. Serialise refreshes in your client.
- Retrying a failed refresh with the same token.
- Reusing a token you stored before an earlier refresh.

The fix is client-side: keep exactly one in-flight refresh and always store the newest token.

### 401 after changing a password

By design. A password change revokes every other session. Pass the current `refreshToken` in the change-password body to keep the calling device signed in.

### A suspended user still has access

They should not — status is re-read from the database on every authenticated request. If you removed that lookup for performance, access persists until the access token expires.

---

## Authorization

### 403 `PERMISSION_DENIED` for a permission I just granted

Grants are cached in-process for 60 seconds (`RbacService`). Wait a minute or restart. If you edited the database directly rather than re-seeding, also confirm the row exists:

```sql
SELECT r.name, p.key FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
ORDER BY r.name, p.key;
```

With multiple instances, each has its own cache — that is the documented Redis swap point.

### A new permission does not exist at all

`PERMISSIONS` in code is only the key list. The rows come from the seed:

```bash
npm run prisma:seed
```

### 403 when editing your own profile

Changing **your own** role or status is forbidden regardless of permissions — that is the privilege-escalation guard. Other profile fields should work; if they do not, check you are sending the right `:id`.

---

## Requests

### 400 with `"message": "Validation failed"`

Read `errors[]` — every failing field is listed at once:

```json
{ "errors": [{ "field": "email", "message": "must be a valid email address" }] }
```

If `field` is `body` rather than a name, the body did not parse as an object at all — check `Content-Type: application/json`.

### A field I sent was silently ignored

Correct behaviour. Zod strips unknown keys, which is the mass-assignment defence. If the field is legitimate, add it to the schema.

### 400 `Malformed JSON in request body`

Invalid JSON. Common in shells: single quotes inside a single-quoted string, or unescaped `"` in a double-quoted one. Put the payload in a file:

```bash
curl -X POST … -H 'Content-Type: application/json' -d @body.json
```

### 413 `Request body is too large`

Over `BODY_LIMIT` (default `100kb`). Raise it for a specific need, but do not remove it — an unbounded body is a trivial memory-exhaustion vector. Large files belong in object storage with a signed URL, not a JSON body.

### 429 `Too many requests`

The auth limiter allows 10 **failed** attempts per 15 minutes; successes do not count. Wait, or raise `AUTH_RATE_LIMIT_MAX` in development.

Remember the store is per process — restarting the dev server clears it.

### 404 on a route that exists

Two usual causes:

**Missing version prefix** — everything is under `/api/v1`, e.g. `/api/v1/users`.

**A literal segment declared after `/:id`.** Express matches in order, so `/users/active` must come _before_ `/users/:id` or "active" is parsed as an id and fails UUID validation.

### CORS blocked in the browser

Add the exact origin — scheme, host and port — to `CORS_ORIGIN`:

```bash
CORS_ORIGIN=http://localhost:5173,https://app.example.com
```

`*` is rejected in production. A blocked origin is logged server-side:

```
"msg":"blocked by CORS allow-list","origin":"http://localhost:3001"
```

Note that curl and Postman ignore CORS entirely — a request that works there and fails in the browser is almost always this.

---

## Tests

### Integration tests fail immediately with a TEST_DATABASE_URL error

Intentional guard. Set it in `.env`, and make it a **different database** from `DATABASE_URL` — the suite truncates every table.

### Integration tests fail with `relation ... does not exist`

The test database has no schema:

```bash
npx tsx scripts/reset-test-db.ts
```

### Tests pass alone but fail together

Almost always a table missing from `TABLES` in `tests/helpers/database.ts`, so rows leak between tests. Add every model you introduce.

### Tests fail with 429

Rate limits are raised in `tests/setup/integration.setup.ts`. If you added a route with its own limiter, that limiter reads its config at import time and is not affected — make its limits configurable too.

---

## Build and deploy

### `npm run build` succeeds but `node dist/server.js` cannot find a module

Path aliases were not rewritten. `tsc` alone does not know what `@/` means at runtime; `tsc-alias` rewrites the emitted imports. Use the script, not `tsc` directly:

```bash
npm run build   # rimraf + tsc + tsc-alias
```

Confirm:

```bash
grep -r 'require("@/' dist/ | head   # should print nothing
```

### `Option 'baseUrl' has been removed` / `moduleResolution=node10 has been removed`

You are on TypeScript 7, which removed both. This template's `tsconfig.json` already avoids them (relative `paths`, `moduleResolution: node16`) and pins TypeScript 5.9 only because typescript-eslint caps its peer range below 6.1. If you upgrade TypeScript, upgrade typescript-eslint with it.

### The container ignores SIGTERM and gets killed

Node as PID 1 does not get default signal handling. The Dockerfile uses `tini` as the entrypoint so `SIGTERM` reaches the process and graceful shutdown runs. If you replaced the entrypoint, restore it. Verify:

```
"msg":"shutdown initiated"
"msg":"http server closed"
"msg":"database disconnected"
"msg":"shutdown complete"
```

### Rate limiting seems to allow far more than configured

The default store is in-memory and per process. With N instances the effective limit is N×, and it resets on every deploy. Move to a shared store before running more than one instance:

```bash
npm i rate-limit-redis ioredis
```

Only `rate-limit.middleware.ts` changes.

### Everything is slow under load

In rough order of likelihood:

1. **Connection pool exhaustion** — `instances × max` against Postgres `max_connections`. Lower the pool in `src/database/prisma.ts` or add PgBouncer.
2. **Unindexed search** — `?search=` compiles to `ILIKE '%term%'`, which no btree can serve. Add `pg_trgm` GIN.
3. **Argon2 under login bursts** — hashing is deliberately expensive. Tune `ARGON2_MEMORY_COST` against measured hardware.
4. **`COUNT(*)` on large filtered lists** — the exact total becomes the slow half. Move to cursor pagination.

---

## Getting more detail

```bash
LOG_LEVEL=debug LOG_PRETTY=true npm run dev
```

`debug` logs every Prisma query with its duration.

Every response carries `X-Request-Id`, and error bodies include `requestId`. Use it to pull the whole request from the logs:

```bash
grep '"reqId":"<id>"' app.log | jq
```

In development, error responses also include a stack trace. In production they never do.
