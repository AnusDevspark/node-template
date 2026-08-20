# Node.js Backend Template

A production-ready, batteries-included backend starter. Clone it, set `.env`, run migrations, and start writing business modules — authentication, authorization, error handling, validation, logging, pagination, docs, Docker and tests already work.

**Stack:** Node.js 24 · TypeScript · Express 5 · PostgreSQL 18 · Prisma 7 · Zod 4 · JWT · Argon2id · Pino · Vitest · Docker

**Architecture:** modular monolith. No NestJS, no DI framework, no Redis. Every abstraction earns its place.

---

## Documentation

| Doc                                                      | Read it when                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| **[docs/getting-started.md](./docs/getting-started.md)** | You just cloned this — first 15 minutes, then making it yours |
| **[docs/adding-a-module.md](./docs/adding-a-module.md)** | You need a new CRUD resource. Complete worked example         |
| **[docs/common-tasks.md](./docs/common-tasks.md)**       | "How do I add a filter / permission / env var / action?"      |
| **[docs/decision-guides.md](./docs/decision-guides.md)** | Not sure which tool the template intends for a problem        |
| **[docs/architecture.md](./docs/architecture.md)**       | You want to know _why_ it is built this way                   |
| **[docs/testing.md](./docs/testing.md)**                 | Writing tests, want the existing patterns                     |
| **[docs/troubleshooting.md](./docs/troubleshooting.md)** | Something broke and the error is unhelpful                    |

The rest of this file is the quick reference.

---

## Requirements

- **Node.js ≥ 22** (24 recommended — see `.nvmrc`)
- **Docker** (for PostgreSQL; a local Postgres 15+ works too)
- **npm** 10+

---

## Quick start

```bash
git clone <this-repo> my-api && cd my-api

cp .env.example .env          # then edit JWT secrets — see below
npm install                   # also generates the Prisma client

docker compose up -d postgres # starts Postgres + creates the test database
npm run db:wait               # blocks until it accepts connections

npm run prisma:migrate        # creates the schema
npm run prisma:seed           # roles, permissions, admin, sample data

npm run dev                   # http://localhost:4000
```

Then:
crea

- API root — <http://localhost:4000/api/v1>
- Docs — <http://localhost:4000/api/docs>
- Health — <http://localhost:4000/health>

Sign in with the seeded admin (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, default `admin@example.com` / `ChangeMe123!`):

```bash
curl -X POST localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}'
```

> **Before deploying anywhere:** generate real secrets with `openssl rand -base64 48` and change the admin password. The app refuses to start in production if the two JWT secrets match.

---

## Environment variables

Every variable is validated by `src/config/env.ts` at startup. A missing or malformed value exits the process immediately with a readable message — a server that cannot serve requests must never look healthy.

| Variable                 | Default                 | Notes                                                                  |
| ------------------------ | ----------------------- | ---------------------------------------------------------------------- |
| `NODE_ENV`               | `development`           | `development` \| `test` \| `production`                                |
| `PORT`                   | `4000`                  |                                                                        |
| `TRUST_PROXY_HOPS`       | `0`                     | Number of proxies in front. **Not** `true` — see [Security](#security) |
| `DATABASE_URL`           | —                       | **Required**                                                           |
| `TEST_DATABASE_URL`      | —                       | Must differ from `DATABASE_URL`; tests truncate it                     |
| `JWT_ACCESS_SECRET`      | —                       | **Required**, ≥32 chars                                                |
| `JWT_REFRESH_SECRET`     | —                       | **Required**, ≥32 chars, must differ from the access secret            |
| `JWT_ACCESS_EXPIRES_IN`  | `15m`                   | Short: access tokens cannot be revoked                                 |
| `JWT_REFRESH_EXPIRES_IN` | `7d`                    | Long: refresh tokens _are_ revocable                                   |
| `ARGON2_MEMORY_COST`     | `19456`                 | KiB. Raise this first to harden hashing                                |
| `ARGON2_TIME_COST`       | `2`                     |                                                                        |
| `ARGON2_PARALLELISM`     | `1`                     |                                                                        |
| `CORS_ORIGIN`            | `http://localhost:4000` | Comma-separated allow-list. Never `*`                                  |
| `LOG_LEVEL`              | `info`                  | `trace`…`fatal`, or `silent`                                           |
| `LOG_PRETTY`             | `false`                 | Human-readable logs in dev; keep JSON in production                    |
| `RATE_LIMIT_MAX`         | `300`                   | General limiter, per window                                            |
| `AUTH_RATE_LIMIT_MAX`    | `10`                    | Failed credential attempts per window                                  |
| `BODY_LIMIT`             | `100kb`                 | Request body ceiling                                                   |
| `SWAGGER_ENABLED`        | `true`                  | Consider `false` for a private production API                          |
| `SHUTDOWN_TIMEOUT_MS`    | `10000`                 | Graceful shutdown ceiling                                              |

---

## Commands

| Command                           | Purpose                                        |
| --------------------------------- | ---------------------------------------------- |
| `npm run dev`                     | Dev server with hot reload (tsx watch)         |
| `npm run build`                   | Compile to `dist/` and rewrite path aliases    |
| `npm start`                       | Run the compiled build                         |
| `npm run typecheck`               | `tsc --noEmit` across src, tests and scripts   |
| `npm run lint` / `lint:fix`       | ESLint                                         |
| `npm run format` / `format:check` | Prettier                                       |
| `npm test`                        | Unit tests (no database)                       |
| `npm run test:watch`              | Unit tests in watch mode                       |
| `npm run test:coverage`           | Unit tests with coverage                       |
| `npm run test:integration`        | Integration tests (migrates the test DB first) |
| `npm run prisma:generate`         | Regenerate the Prisma client                   |
| `npm run prisma:migrate`          | Create and apply a migration (dev)             |
| `npm run prisma:migrate:deploy`   | Apply migrations (production/CI)               |
| `npm run prisma:studio`           | Prisma's database browser                      |
| `npm run prisma:seed`             | Seed roles, permissions, admin, samples        |
| `npm run db:wait`                 | Block until the database accepts connections   |

---

## Docker

`docker compose up -d` starts **only PostgreSQL** on purpose — the fastest inner loop is `npm run dev` on the host against a containerised database (instant reload, native debugger, no volume-mount tax).

To run the API in a container as well:

```bash
docker compose --profile api up -d --build
```

The production image is multi-stage: build tooling and dev dependencies never reach the runtime layer, it runs as the unprivileged `node` user, and `tini` is PID 1 so `SIGTERM` reaches Node and graceful shutdown actually runs.

Migrations are deliberately **not** run on container start — every replica would race. Run `npm run prisma:migrate:deploy` as a separate release step.

---

## Architecture

```
Request
  → global middleware (request id, helmet, CORS, logging, body limits, rate limit)
  → route
  → validation middleware (Zod)
  → authenticate  (who are you?)
  → authorize     (are you allowed?)
  → controller    (HTTP only)
  → service       (business rules)
  → repository    (persistence only)
  → Prisma → PostgreSQL
```

and back out through the mapper, the response helper, and — on failure — the single global error handler.

### Responsibilities

| Layer          | Does                                                       | Never does                                     |
| -------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| **Route**      | Declares the middleware chain                              | Business logic, inline handlers                |
| **Controller** | Reads validated input, calls one service, sends a response | Prisma, business rules, building error bodies  |
| **Service**    | Business rules, transaction boundaries                     | Touches `Request`/`Response`, knows about HTTP |
| **Repository** | Reads and writes                                           | Business rules, opening transactions           |
| **Mapper**     | Entity → DTO, field by field                               | Returns Prisma records directly                |

### Dependency rules

- `shared/` and `errors/` may not import feature modules.
- Feature modules import each other's **public** pieces only (`user.repository`, not another module's internals).
- Infrastructure (`config/`, `database/`) never imports a controller.
- Everything is wired in **one** place: `src/routes/index.ts`.

---

## Project structure

```
src/
├── app.ts                    Express assembly (no listen)
├── server.ts                 Entry point, signals, graceful shutdown
├── config/                   env (Zod-validated), constants, Pino logger
├── database/prisma.ts        Single PrismaClient + pg adapter
├── errors/                   AppError + 8 subclasses + error codes
├── middleware/               request-id, logging, security, rate limit,
│                             validate, authenticate, authorize, 404, errors
├── shared/
│   ├── constants/            roles, permissions
│   ├── response/             envelope types + send helpers
│   ├── types/                Express augmentation, JWT payloads, list query
│   ├── utils/                pagination, sorting, filtering, jwt, password,
│   │                         token hashing, normalisation, Prisma error mapper
│   └── validation/           reusable Zod pieces
├── docs/                     OpenAPI document + Swagger mount
├── routes/index.ts           ← composition root; /api/v1 declared once
└── modules/
    ├── health/               liveness + readiness
    ├── rbac/                 role → permission resolution (cached)
    ├── auth/                 register, login, refresh, logout, me, password
    ├── user/                 user administration
    └── user/                 the worked example — the one to copy

prisma/     schema.prisma, migrations, seed.ts
tests/      unit/, integration/, helpers/, setup/
scripts/    wait-for-db, reset-test-db
```

---

## Authentication

### Tokens

|             | Lifetime | Revocable | Where                           |
| ----------- | -------- | --------- | ------------------------------- |
| **Access**  | 15 min   | No        | `Authorization: Bearer <token>` |
| **Refresh** | 7 days   | Yes       | Request body                    |

The access token is short _because_ it cannot be revoked — that is the inherent trade of a stateless JWT. The refresh token is long _because_ it is database-backed and can be killed instantly.

The JWT payload carries `sub`, `email`, `role` and nothing else. No secrets (a JWT is signed, not encrypted) and no permission list (it would go stale, so revoking a permission would not take effect until expiry).

### Refresh token security

Three controls, all implemented:

1. **Hashed at rest** — only the SHA-256 is stored, so a database dump yields nothing replayable.
2. **Rotation** — every refresh issues a new token and revokes the old one, so a token is usable exactly once.
3. **Reuse detection** — rotated rows are kept, so presenting an already-used token is detectable. It means the token was captured, and since we cannot tell whether the attacker or the victim is presenting it, **the entire rotation family is revoked**. Losing a session beats leaving one hijacked.

### Why the refresh token is in the response body, not a cookie

This template serves browser SPAs, native mobile apps and server-to-server clients. Cookies only exist for the first; choosing them here would force CORS-credentials, `SameSite` and CSRF decisions onto every project that clones this, based on a frontend the repository knows nothing about.

The XSS risk that cookies address is handled at the protocol level instead (rotation + hashing + family revocation). **Browser clients should keep the refresh token in memory, not `localStorage`.**

To switch to cookies: set it in `auth.controller.ts` and read `req.cookies` in `refresh`/`logout`. The service layer does not change. Add CSRF protection when you do.

### What happens when

| Event                  | Effect                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password changed       | All other sessions revoked; the calling device survives if it sends its `refreshToken`. Already-issued access tokens stay valid until they expire (≤15 min) |
| Logout                 | That session revoked. `allDevices: true` revokes all                                                                                                        |
| Account suspended      | Access ends on the **next request** — `authenticate` re-reads status every time                                                                             |
| Refresh token replayed | Whole family revoked, full re-login required                                                                                                                |

### Not implemented (but architected for)

Password reset, email verification. `EmailService` is a working interface with a console implementation, and `RefreshSession` demonstrates the hashed-token-table pattern both need. They are left out because both require product decisions (token lifetime, whether unverified accounts may log in, what the reset link points at). Adding them is one schema model and two endpoints — no change to the flows above.

---

## Authorization

**Authentication** asks "who are you?". **Authorization** asks "are you allowed?". They are separate middleware.

```ts
router.post('/', authenticate, requirePermission(PERMISSIONS.USER_CREATE), controller.create);
```

- `authorizeRoles('ADMIN')` — coarse, for whole-surface restrictions.
- `requirePermission('USER_CREATE')` — **prefer this.** Grants live in the database, so an operator can create a "SUPPORT" role that reads users but cannot delete them, with no code change.

**Permission keys live in code** (`shared/constants/permissions.constant.ts`) because call sites must be typo-proof. **Grants live in the database** because that is what operators need to change at runtime. Seeding only adds grants; it never deletes ones made by hand.

### Ownership vs roles

A user may edit their **own** profile without `USER_EDIT`. Middleware cannot enforce that — it does not know which record is being touched. So ownership rules live at the top of the service method (`UserService.updateUser`), which is also where they stay correct when a second entry point appears.

There is an escalation guard: **nobody may change their own role or status**, regardless of permissions. Without it, an admin holding `USER_EDIT` could promote themselves.

---

## List endpoints

Every list endpoint follows one shape:

```
GET /api/v1/users?page=1&pageSize=20&search=john&status=ACTIVE
    &role=ADMIN&sortBy=createdAt&sortOrder=desc
```

- **Pagination** — defaults 1/20, hard max 100. Without the cap, `pageSize=1000000` is a free table scan.
- **Sorting** — each module whitelists its sortable fields (`USER_SORT_FIELDS`). An unlisted field is a 400, never passed to Prisma.
- **Filtering** — each module names its filters explicitly. The query object is never forwarded whole.
- **Search** — case-insensitive (`ILIKE`) across chosen fields. Note this is **unindexed**; a btree cannot serve `ILIKE '%term%'`. Fine at moderate scale; add a `pg_trgm` GIN index when it stops being fine.

---

## Errors

Throw, never build a response:

```ts
throw new NotFoundError('User not found');
```

becomes

```json
{ "success": false, "message": "User not found", "code": "NOT_FOUND", "requestId": "..." }
```

The global handler understands `AppError`, Zod errors, JWT errors, Prisma codes (P2002 → 409, P2025 → 404, P2003 → 400), malformed JSON, oversized payloads, and anything unknown. Stack traces never leave the server in production; unexpected errors are logged with full context and reported generically.

**Validation always uses 400**, never 422 — one convention, so clients need one branch.

---

## Testing

```bash
npm test              # unit — no database, ~300ms
npm run test:integration  # real Postgres + real Express via Supertest
```

**Unit tests** exercise services against plain object stand-ins for repositories. Possible only because services take collaborators through the constructor and never import a singleton.

**Integration tests** run against a real PostgreSQL test database — not SQLite. Testing on a different engine leaves case-insensitive search, enum types, `@db.Date` handling and constraint behaviour untested, which is exactly what breaks.

**Reset strategy:** `TRUNCATE ... RESTART IDENTITY CASCADE` between tests, then re-seed roles and permissions. Faster than row deletes, no FK ordering concerns, and it does not interfere with the transactions the app itself opens.

Helpers: `createTestUser`, `generateTestToken`, `login`, `authenticatedRequest`, `resetDatabase`.

---

## Security

| Concern             | How it is handled                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| SQL injection       | Prisma parameterises everything. The one `$executeRawUnsafe` is test-only with a hardcoded table list                    |
| Mass assignment     | Zod strips unknown keys; services name every field they write; repositories never take a request body                    |
| Password storage    | Argon2id, per-password salt, tunable cost                                                                                |
| Brute force         | Strict limiter on credential endpoints, counting failures only                                                           |
| Account enumeration | Login returns an identical error for wrong password and unknown account, with timing equalised                           |
| JWT theft           | 15-minute access lifetime; status re-checked on every request                                                            |
| Refresh replay      | Rotation + hashed storage + family revocation                                                                            |
| XSS (for an API)    | `nosniff` stops a JSON response being executed as HTML; CSP set                                                          |
| CORS                | Explicit allow-list; `*` rejected outright in production                                                                 |
| Oversized bodies    | `BODY_LIMIT`, rejected by the parser → 413                                                                               |
| Error leakage       | Stack traces dev-only; Prisma codes never reach clients                                                                  |
| Data exposure       | Mappers build DTOs field by field; `passwordHash` is asserted absent in tests                                            |
| Header spoofing     | `trust proxy` is a **hop count**, not `true` — otherwise any client can forge `X-Forwarded-For` and defeat rate limiting |

Logs redact `authorization`, `cookie`, and any field named like a password or token.

---

## Adding a new module

Copy `src/modules/user/` and work through it. In short: add the model and its indexes to `prisma/schema.prisma`, add permissions, then write `*.schema.ts`, `*.repository.ts`, `*.service.ts`, `*.controller.ts` and `*.routes.ts` (plus `*.types.ts` and `*.mapper.ts` in most cases). Wire it in `src/routes/index.ts`, document it in `src/docs/openapi.ts`, and test it.

**→ [docs/adding-a-module.md](./docs/adding-a-module.md)** walks through a complete Task module — every file, full contents, with a foreign key to `User`, an enum filter, a date-range filter and a non-CRUD business action.

---

## Production checklist

- [ ] Real `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (`openssl rand -base64 48`), different from each other
- [ ] `CORS_ORIGIN` set to your actual frontends
- [ ] `TRUST_PROXY_HOPS` matches your real proxy count
- [ ] `NODE_ENV=production`, `LOG_PRETTY=false`
- [ ] Admin password changed from the seed default
- [ ] `SWAGGER_ENABLED=false` if the API is private
- [ ] `prisma migrate deploy` runs as a release step, not on container start
- [ ] A shared rate-limit store (Redis) before running more than one instance

---

## Further reading

**[docs/](./docs/)** — getting started, adding a module, common tasks, decision guides, architecture, testing, troubleshooting.

**[docs/architecture.md](./docs/architecture.md)** in particular covers the request and login walkthroughs, every design tradeoff, the scalability path, and where caching, jobs, webhooks, storage and observability fit when you need them.
