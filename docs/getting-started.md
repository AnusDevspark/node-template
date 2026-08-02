# Getting started

From `git clone` to a running API, then making it yours.

---

## 1 — Run it

```bash
cp .env.example .env
npm install                     # postinstall also runs `prisma generate`

docker compose up -d postgres   # Postgres + the app_test database
npm run db:wait                 # blocks until it accepts connections

npm run prisma:migrate          # creates the schema
npm run prisma:seed             # roles, permissions, admin, 5 sample providers

npm run dev
```

Four URLs to check:

| URL                              | Expect                                                         |
| -------------------------------- | -------------------------------------------------------------- |
| <http://localhost:3000/health>   | `"status":"healthy"`, `"database":"up"`                        |
| <http://localhost:3000/api/v1>   | Service name and version                                       |
| <http://localhost:3000/api/docs> | Swagger UI                                                     |
| <http://localhost:3000/nope>     | `{"success":false,"message":"Route not found: GET /nope",...}` |

If `/health` says `database: down`, the container is up but Postgres is still initialising — `npm run db:wait`.

---

## 2 — Log in

The seed creates an admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

```bash
curl -s -X POST localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}'
```

```json
{
  "success": true,
  "message": "Logged in successfully.",
  "data": {
    "user": { "id": "…", "email": "admin@example.com", "role": "SUPER_ADMIN", … },
    "tokens": {
      "accessToken": "eyJ…",
      "refreshToken": "eyJ…",
      "expiresIn": 900,
      "tokenType": "Bearer"
    }
  }
}
```

Save the access token and use it:

```bash
TOKEN="paste-accessToken-here"
curl -s localhost:3000/api/v1/providers -H "Authorization: Bearer $TOKEN"
curl -s localhost:3000/api/v1/auth/me   -H "Authorization: Bearer $TOKEN"
```

Or click **Authorize** in Swagger UI and paste the token once — it persists across reloads.

### Try the things that make this a template, not a demo

```bash
API=localhost:3000/api/v1

# Pagination metadata
curl -s "$API/providers?page=1&pageSize=2" -H "Authorization: Bearer $TOKEN"

# Case-insensitive search across firstName, lastName, email
curl -s "$API/providers?search=JOHN" -H "Authorization: Bearer $TOKEN"

# Sorting is whitelisted — this one is rejected with a 400, not silently ignored
curl -s "$API/providers?sortBy=id" -H "Authorization: Bearer $TOKEN"

# Validation collects every field error at once
curl -s -X POST "$API/providers" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"","email":"nope","dateOfBirth":"2099-01-01"}'
```

### Watch a permission denial

Register a normal account and try an admin action:

```bash
USER_TOKEN=$(curl -s -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"firstName":"Reg","lastName":"User","email":"reg@example.com","password":"RegularPass123"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.tokens.accessToken))")

# 200 — a USER holds PROVIDER_VIEW
curl -s "$API/providers" -H "Authorization: Bearer $USER_TOKEN"

# 403 PERMISSION_DENIED — a USER does not hold PROVIDER_CREATE
curl -s -X POST "$API/providers" -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"A","lastName":"B","dateOfBirth":"1990-01-01","email":"a@b.com","speciality":"X"}'
```

### Watch refresh-token theft detection

This is the part worth understanding before you build on it:

```bash
RT="paste-refreshToken-here"

# Rotate. You get a NEW refresh token; the old one is now dead.
curl -s -X POST $API/auth/refresh -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$RT\"}"

# Present the OLD one again — this is what a thief would do.
# The whole session family is revoked and BOTH tokens stop working.
curl -s -X POST $API/auth/refresh -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$RT\"}"
# → 401 AUTH_SESSION_REVOKED
```

---

## 3 — Run the tests

```bash
npm test                  # unit, no database, ~300ms
npm run test:integration  # real Postgres + real Express (migrates app_test first)
```

Both should be green on a fresh clone. If integration fails on the first run, it is nearly always `TEST_DATABASE_URL` — see [troubleshooting](./troubleshooting.md).

---

## 4 — Make it yours

Work down this list before writing features.

### Required

**Generate real JWT secrets.** Two different ones:

```bash
echo "JWT_ACCESS_SECRET=$(openssl rand -base64 48)"
echo "JWT_REFRESH_SECRET=$(openssl rand -base64 48)"
```

The app refuses to boot in production if they match, but it cannot tell that you kept the placeholder in staging. Do it now.

**Change the admin password** in `.env` before seeding a shared environment.

**Set `CORS_ORIGIN`** to your real frontend origins, comma-separated. `*` is rejected in production.

### Rename the service

| File                      | Change                            |
| ------------------------- | --------------------------------- |
| `package.json`            | `name`, `description`             |
| `src/config/constants.ts` | `SERVICE_NAME`, `SERVICE_VERSION` |
| `.env.example` and `.env` | `JWT_ISSUER`, `JWT_AUDIENCE`      |
| `docker-compose.yml`      | `container_name` values           |

Changing `JWT_ISSUER` / `JWT_AUDIENCE` invalidates every existing token — do it before you have users, not after.

### Decide what to delete

The Provider module is a worked example, not a dependency. When you are comfortable with the patterns:

```bash
rm -rf src/modules/provider
rm tests/unit/provider.service.test.ts tests/integration/provider.integration.test.ts
```

Then remove its wiring from `src/routes/index.ts`, its `PROVIDER_*` permissions from `src/shared/constants/permissions.constant.ts`, its paths from `src/docs/openapi.ts`, and the `Provider` model from `prisma/schema.prisma`.

**Keep it until your first module is working.** It is the reference you will copy from, and [adding-a-module.md](./adding-a-module.md) assumes it exists.

### Things you probably should not remove

Environment validation, the error classes, the response helpers, request IDs, the validation middleware, graceful shutdown, and the mappers. Each is small and each prevents a class of bug. See [decision-guides.md](./decision-guides.md#what-to-keep-and-what-to-cut).

---

## 5 — Daily workflow

```bash
docker compose up -d postgres   # once per boot
npm run dev                     # hot reload

# after editing prisma/schema.prisma
npm run prisma:migrate

# before committing
npm run typecheck && npm run lint && npm test
```

`npm run prisma:studio` opens a database browser if you would rather click than write SQL.

---

## What to read next

- Adding your first resource → **[adding-a-module.md](./adding-a-module.md)**
- A specific small task → **[common-tasks.md](./common-tasks.md)**
- Why any of this is shaped the way it is → **[architecture.md](./architecture.md)**
