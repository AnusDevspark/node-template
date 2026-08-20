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
npm run prisma:seed             # roles, permissions, admin, 5 sample accounts

npm run dev
```

Four URLs to check:

| URL                              | Expect                                                         |
| -------------------------------- | -------------------------------------------------------------- |
| <http://localhost:4000/health>   | `"status":"healthy"`, `"database":"up"`                        |
| <http://localhost:4000/api/v1>   | Service name and version                                       |
| <http://localhost:4000/api/docs> | Swagger UI                                                     |
| <http://localhost:4000/nope>     | `{"success":false,"message":"Route not found: GET /nope",...}` |

If `/health` says `database: down`, the container is up but Postgres is still initialising — `npm run db:wait`.

---

## 2 — Log in

The seed creates an admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

```bash
curl -s -X POST localhost:4000/api/v1/auth/login \
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
curl -s localhost:4000/api/v1/users   -H "Authorization: Bearer $TOKEN"
curl -s localhost:4000/api/v1/auth/me -H "Authorization: Bearer $TOKEN"
```

`/auth/me` returns your permission keys alongside the profile. That array is what a
frontend uses to decide what to render — see `API-CONTRACT.md`.

Or click **Authorize** in Swagger UI and paste the token once — it persists across reloads.

### Try the things that make this a template, not a demo

```bash
API=localhost:4000/api/v1

# Pagination metadata
curl -s "$API/users?page=1&pageSize=2" -H "Authorization: Bearer $TOKEN"

# Case-insensitive search across firstName, lastName, email
curl -s "$API/users?search=JOHN" -H "Authorization: Bearer $TOKEN"

# Sorting is whitelisted — this one is rejected with a 400, not silently ignored
curl -s "$API/users?sortBy=passwordHash" -H "Authorization: Bearer $TOKEN"

# So is an oversized page — a 400, never a silent clamp
curl -s "$API/users?pageSize=101" -H "Authorization: Bearer $TOKEN"

# Validation collects every field error at once
curl -s -X POST "$API/users" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"","email":"nope","password":"short"}'
```

### Watch a permission denial

Register a normal account and try an admin action:

```bash
USER_TOKEN=$(curl -s -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"firstName":"Reg","lastName":"User","email":"reg@example.com","password":"RegularPass123"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.tokens.accessToken))")

# 200 — anyone signed in may read their own profile
curl -s "$API/auth/me" -H "Authorization: Bearer $USER_TOKEN"

# 403 PERMISSION_DENIED — the USER role holds no USER_VIEW grant
curl -s "$API/users" -H "Authorization: Bearer $USER_TOKEN"

# 403 again — nor USER_CREATE
curl -s -X POST "$API/users" -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"A","lastName":"B","email":"a@b.com","password":"LongEnough123","role":"USER"}'
```

The seeded `USER` role deliberately holds **no** permissions. Editing your own profile is
not one — it is an ownership rule enforced in `UserService`, which is why
`PATCH /users/:id` has no permission gate on the route.

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

### There is nothing to delete

This template ships no business domain on purpose. The only resource is `User`, and you
need it — authentication depends on it. So there is no sample module to strip out, and
nothing in the code to mislead you (or a coding assistant) about what your project is.

`src/modules/user/` doubles as the reference implementation: it exercises pagination,
whitelisted filtering, whitelisted sorting, search, an ownership rule and a mapper. Copy
its shape for your first real module, and follow
[adding-a-module.md](./adding-a-module.md) for the step-by-step version.

The sample *accounts* the seed creates (five of them, so a list has something to
paginate) are skipped when `NODE_ENV=production`.

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
