# Architecture

Design decisions, request walkthroughs, and where things go when you need them. See [getting-started.md](./getting-started.md) for setup, and the [root README](../README.md) for the overview.

---

## Guiding principle

**Batteries included, not overengineered.** Every abstraction must earn its existence. The test applied throughout: _does removing this make the code worse?_ If not, it is not here.

Things deliberately **not** built: `BaseController`/`BaseService`/`BaseRepository<T>`, a DI container, an event bus, CQRS, domain events, GraphQL, Redis, a job queue, a soft-delete framework, an audit system. Each is discussed below with the trigger that would justify it.

---

## Request walkthrough: `POST /api/v1/users`

**1. Request arrives.** Express receives it. `trust proxy` is set to a hop count, so `req.ip` is the real client address rather than the proxy's — and a client cannot forge it by sending its own `X-Forwarded-For`.

**2. Request id assigned.** `requestId` reuses an inbound `X-Request-Id` if it is well-formed (so a trace spans the whole hop chain) or generates a UUID. It is set on `req.id`, echoed in the response header, and appears in every log line for this request.

**3. Security headers.** Helmet sets `nosniff`, `frame-ancestors`, CSP, `Referrer-Policy`, and HSTS in production.

**4. CORS.** The `Origin` is checked against the allow-list. No origin (curl, mobile, server-to-server) is allowed — CORS is a browser mechanism and blocking those protects nobody. An unlisted origin gets no CORS headers, so the browser blocks the response.

**5. HTTP logging begins.** `pino-http` starts timing and will emit one structured line on completion. Explicit serialisers log a handful of fields, never the whole header bag.

**6. Body parsed, bounded.** `express.json({ limit })`. An oversized payload is rejected here and becomes a 413; malformed JSON becomes a 400.

**7. Rate limit checked.** The general limiter counts against `req.ip`. Over the limit → `TooManyRequestsError` → the standard 429 envelope.

**8. Route matched.** `/api/v1` is stripped by the mount in `routes/index.ts`; `userRouter` matches `POST /`.

**9. Authenticate.** The bearer token is extracted and verified — signature, expiry, issuer, audience, and the `type` claim (so an access token cannot be replayed at the refresh endpoint). Then a single indexed read confirms the account still exists and is `ACTIVE`, and re-reads the role. This costs one primary-key lookup and buys immediate revocation: a suspended user loses access on their next request instead of up to 15 minutes later. `req.user` is set.

**10. Authorize.** `requirePermission(USER_CREATE)` asks `RbacService`, which resolves the role's permissions from a 60-second in-process cache (a database read on a miss). Not held → 403 with `PERMISSION_DENIED`.

**11. Validate.** `validate({ body: createUserSchema })` parses the body. Zod strips unknown keys, so `req.body` afterwards contains **only** declared fields — an injected `"id"` or `"role"` is gone before any application code sees it. Emails are lowercased and names trimmed. On failure, every field error is collected into one 400 rather than reporting them one at a time.

**12. Controller.** Reads `req.body`, calls `userService.createUser(input)`, sends the response. Three lines. No try/catch — Express 5 forwards a rejected promise to the error handler automatically.

**13. Service.** Applies the business rule: is this email already taken? If so, `ConflictError`. Then it builds the create payload **by naming each field**, so nothing unexpected can reach the database even if validation were bypassed.

**14. Repository.** Executes `prisma.user.create` with an explicit `data` object, wrapped in `withPrismaErrors` so a unique-constraint violation becomes a `ConflictError` rather than leaking `P2002`.

**15. PostgreSQL.** The row is written; the unique index is the real guarantee against a concurrent duplicate that passed the service check.

**16. Mapper.** `mapUserToResponse` builds the DTO field by field — never a spread, which would leak whatever column gets added next. Dates become ISO-8601 strings, and `passwordHash` is simply never named, so it cannot leak.

**17. Response.** `sendCreated(res, user, 'User created successfully.')` → 201 with the standard envelope.

**18. Logged.** One line: request id, method, path, 201, duration.

### When it fails

Any throw at any depth propagates to `errorHandler`. It normalises the error (AppError → itself; ZodError → 400 with field errors; Prisma → mapped status; unknown → 500), logs at a level that matches intent (an expected 404 is `warn`, an unexpected 500 is `error` with a stack), and emits the same envelope shape as every other error. In production, a non-operational error's message is replaced with a generic one and the stack is never sent.

---

## Login walkthrough: `POST /api/v1/auth/login`

1. **Rate limited** by the strict auth limiter, counting failures only, so a legitimate user is never locked out by their own successful activity.
2. **Validated.** Login deliberately does _not_ apply the password policy — enforcing current rules on an existing password would reject users whose password predates a policy change, and the shape of the rejection leaks the policy.
3. **Email normalised** to lowercase, matching how it was stored.
4. **User looked up** by the unique email index.
5. **If absent:** a dummy Argon2 verification runs anyway, then the generic error is thrown. Without that, a missing account answers measurably faster and the endpoint becomes a timing oracle.
6. **Password verified** with Argon2id.
7. **Status checked — after the password.** Checking it first would confirm an account exists to anyone guessing passwords.
8. **Tokens issued.** A session id and family id are generated up front so the id can go into the refresh token's `jti` before the row exists. The access token carries `sub`/`email`/`role`; the refresh token carries `sub`/`jti`/`fid`.
9. **Session persisted** with the SHA-256 of the refresh token — never the token itself — plus expiry and optional IP/user-agent.
10. **Response:** the safe user DTO (no `passwordHash`) and both tokens.

### Refresh, and why replay kills the family

A refresh presents its token. We verify the signature, hash it, and look up the row. If the row is **revoked**, that token was already rotated — the legitimate client would have moved on to its successor, so someone captured this one. We cannot tell whether the attacker or the victim is holding it, so the **entire family** is revoked and both must log in again. Losing a session is strictly better than leaving one hijacked.

The rotate-and-revoke pair runs inside one `$transaction`, so a crash cannot leave two valid tokens or none.

---

## Key decisions

### Argon2id, via `@node-rs/argon2`

Memory-hard, so GPUs and ASICs gain far less than against bcrypt's fixed 4 KiB working set. OWASP's recommendation for new applications.

The `argon2` package builds from C++ through node-gyp and fails `npm install` on any machine without Python and a toolchain — verified during development of this template. `@node-rs/argon2` is Rust with prebuilt binaries for every target including linux-musl. Identical security, installable everywhere.

### Express 5, so `asyncHandler` is optional

On Express 4 a rejected promise never reached the error middleware, which is why every Express 4 codebase wraps handlers. Express 5 forwards them automatically. `asyncHandler` remains in `shared/utils/` as a readable seam for cross-cutting concerns, but no controller uses it and none needs to.

### One role per user; permissions in the database

`User.roleId` is singular. Nothing in the domain needs two roles at once, and a `UserRole` join table would add a hop to every permission check — a cost paid on every request for a capability nobody asked for.

Permission **keys** live in code (call sites must be typo-proof); **grants** live in the database (operators must change them without a deploy). Adding multi-role later is a join table, a changed lookup in `RbacRepository`, and a `roles` array in the mapper. Nothing above the service layer changes.

### Hard delete for User

`status` already models "should not be able to sign in", which is the real business concept — an account can be `INACTIVE` or `SUSPENDED` without being gone. A `deletedAt` column on top of that would force a filter into every query and every uniqueness check, and break the unique email constraint (a deleted account's address would stay reserved forever).

**To add soft delete later:** add `deletedAt DateTime?`, filter it in `UserRepository.buildWhere` and `findById`, and switch the unique index to a partial one (`WHERE deleted_at IS NULL`). Two methods change; no service or controller does. That containment is the reason the repository layer exists.

Use soft delete when there is a real requirement — regulatory retention, undo, or referential history — not by default.

### No generic repository

Two repositories with materially different query shapes. A `BaseRepository<T>` would abstract five one-line CRUD calls while forcing both entities to share one notion of filtering and sorting — the part that actually differs. The genuinely reusable logic is in _functions_ instead: `buildSearchFilter`, `buildOrderBy`, `getPagination`, `withPrismaErrors`. Composition over inheritance, and the concrete class stays readable.

### Manual dependency wiring

`src/routes/index.ts` states the entire dependency graph in about twenty lines. A container would replace code you can read with configuration you cannot, and the compiler already catches a wrong wiring. Revisit if the graph reaches a few dozen nodes.

### Transactions belong to services

The service opens the transaction, because "these operations belong together" is a business statement. Repositories accept an optional transaction client and work identically inside or outside one. Push the boundary down into the repository and two repositories can no longer be composed into one atomic operation. See `AuthService.changePassword` and `AuthService.refresh`.

### OpenAPI from the validation schemas

The document is generated from the same Zod objects `validate()` uses, via `zod-openapi` (chosen over `@asteasolutions/zod-to-openapi` because it supports Zod 4 without patching Zod's prototype). Adding a required field changes validation and documentation in one commit. Paths and descriptions are still hand-written — a schema describes a shape, not an endpoint's meaning.

### Indexing follows query patterns

Each index exists for a query that actually runs:

| Index                                 | Serves                             |
| ------------------------------------- | ---------------------------------- |
| `users.email` (unique)                | Login lookup                       |
| `users.roleId`                        | Permission resolution join         |
| `users.status`                        | Admin filtering                    |
| `refresh_sessions.tokenHash` (unique) | Every refresh                      |
| `refresh_sessions.familyId`           | Replay revocation                  |
| `refresh_sessions.expiresAt`          | Cleanup                            |
| `users.createdAt`                     | Recency sort, the default ordering  |

Do not index every column: each one slows writes and consumes space. Add indexes from `EXPLAIN ANALYZE` on real queries, not from intuition.

---

## Where things go when you need them

None of these are built. Each has a defined home and a trigger.

### Caching — `src/infrastructure/cache/`

`RbacService` already caches permission grants in an in-process `Map` with a 60-second TTL, and its comment marks the swap point. Introduce a `CacheService` interface with a Redis implementation when you run **more than one instance and need cache coherency**, or when profiling shows a specific expensive query dominating. Not before — a cache is a second source of truth and an invalidation bug.

### Background jobs — `src/jobs/` and `src/workers/`

For email delivery, PDF generation, report building, image processing. **BullMQ + Redis** is the default choice. The trigger is a request that takes longer than a user should wait, or work that must survive a process restart.

Workers run as a **separate process** (`node dist/workers/index.js`), not inside the API — otherwise a heavy job blocks request handling and scaling the two independently becomes impossible.

### Scheduled tasks — `src/jobs/scheduled/`

The obvious first one already has a home: `AuthRepository.deleteExpiredSessions`.

**The multi-instance problem:** run `node-cron` inside the API and every replica fires the same job at the same time. Three replicas means three concurrent cleanup runs — or three duplicate emails to every user. Solve it with a distributed lock (Redis `SET NX`), a database advisory lock, or by moving schedules to infrastructure (a Kubernetes CronJob, an ECS scheduled task). Never put a cron inside a controller file.

### Email — implemented interface, no provider

`EmailService` in `src/modules/auth/email.service.ts` is a real interface with a console implementation. Add `ResendEmailService` or `SesEmailService` next to it and change one line in the composition root. Auth flows do not change.

### File storage — `src/infrastructure/storage/`

A `StorageService` interface (`upload`, `getSignedUrl`, `delete`) with S3, R2 or local implementations. **Controllers must never import the AWS SDK** — that dependency belongs behind the interface, or swapping providers becomes a rewrite. Multer handles multipart at the middleware layer.

### External services — `src/infrastructure/<vendor>/`

Same pattern: a small adapter exposing the operations _your domain_ needs, not a mirror of the vendor's API. `PaymentGateway.charge(amount, customer)`, not a Stripe client passed around. Build the adapter when the second implementation appears or when the vendor's types start leaking into services — not speculatively.

### Webhooks — `src/modules/webhooks/`

Genuinely different from normal endpoints, so keep them separate:

- **Raw body required.** Signature verification hashes the exact bytes; parsed-then-restringified JSON will not match. Mount `express.raw({ type: 'application/json' })` on the webhook path only.
- **Signature, not JWT.** The caller is a third-party server. Do not run these through `authenticate`.
- **Idempotency required.** Providers retry, and duplicate delivery is normal. Store processed event ids and no-op on repeats.
- **Respond fast.** Acknowledge within seconds, queue the work.

### Idempotency keys

Needed where a duplicate request causes real harm: payments, order creation, webhook processing. An `Idempotency-Key` header plus a table of key → response, replaying the stored response on a repeat.

Not global. A duplicate `GET` is harmless and a duplicate `PATCH` with the same body converges — paying the storage and complexity cost everywhere to protect a few endpoints is the wrong trade.

### Audit logging — `src/modules/audit/`

Who changed a user, who altered permissions, who deleted an account. An `AuditService` called from **services** (which know the business meaning of the change), not from repositories (which see only rows).

Write it when you have a compliance requirement or a real "who did this?" incident. A generic audit framework built speculatively logs everything, is read by nobody, and grows faster than the data it describes.

### Observability

Add in this order, driven by pain:

1. **Error monitoring** (Sentry) — first, always. Structured logs tell you something broke; this tells you what and how often.
2. **Metrics** (`prom-client` → Prometheus → Grafana) — request rate, error rate, latency percentiles, pool saturation.
3. **Tracing** (OpenTelemetry) — when a request crosses several services and "which hop is slow?" stops being obvious.
4. **Log aggregation** — as soon as there is more than one instance. The logs are already structured JSON with correlation ids, so this is configuration, not code.

---

## Module boundaries

Current modules: `auth`, `user`, `rbac`, `health`. Yours might be `billing`, `notification`, `report`.

**The rule:** a module owns its tables and exposes a service (or repository) as its public surface. Never reach into another module's internals from across a boundary.

### When modules must collaborate

1. **Direct service call** — simplest, correct for a synchronous need. `AuthService` uses `UserRepository` this way. Watch for cycles.
2. **Shared read model** — when one module only needs a projection of another's data.
3. **Events** — when the caller genuinely should not care who reacts (`user.registered` → send welcome email, provision defaults). Introduce an emitter **only when a second consumer appears**. Adding one for a single consumer makes control flow invisible for no benefit.

Prevent cycles: `shared/` never imports a module; infrastructure never imports a controller; if two modules need each other, the shared concept usually belongs in a third.

### Extracting a service later

A module that already respects those boundaries is extractable: it has its own tables, a service-shaped public interface, and no reach into others' internals. Extraction becomes replacing in-process calls with HTTP or a queue, splitting the schema, and moving deployment.

**Do not design for that now.** Distributed transactions, network partitions and eventual consistency are enormous costs, and most applications never need to pay them. Good module boundaries are worth having anyway, because they make the monolith easier to work in today.

---

## Scaling path

**Registered user count is the wrong metric.** A million dormant accounts cost less than a thousand users generating constant traffic. Watch instead: requests per second, concurrent users, database query time (p95/p99), background workload, data volume, latency requirements, and traffic shape (steady vs spiky).

### ~100 users / low traffic

What is here is enough. One instance, one database. Pagination and indexes are in place from the start, which is the point.

### ~1,000 users

Nothing structural. Focus on discipline:

- `EXPLAIN ANALYZE` your slowest queries; index from evidence.
- Watch for N+1 — Prisma's `include` batches; a loop of `findUnique` does not.
- `select` only the columns you need on hot paths (`findAuthContextById` already does).
- Tune the connection pool: total connections across all instances must stay under Postgres `max_connections`.
- Get error monitoring in place.

### ~10,000 users

Now the architecture changes:

- **Multiple instances behind a load balancer.** The app is already stateless — sessions live in the database, not in memory.
- **Redis becomes justified**, for three things at once: a shared rate-limit store (until then, N instances mean N× the configured limit), a shared cache, and a job queue backend.
- **Background workers** as separate processes.
- **Object storage** for files; never the application filesystem.
- **Real observability** — metrics and aggregated logs.

### 100,000+ users

- Horizontal scaling of stateless app servers, which is already possible.
- **Read replicas** for reporting and heavy reads.
- Partition or archive the largest tables (`refresh_sessions` grows fastest and prunes easily).
- Consider extracting genuinely high-load modules — after the boundaries have proven themselves.
- CDN, queue infrastructure, connection pooler (PgBouncer) in front of Postgres.

### First bottlenecks, in the order they usually bite

1. **Database connections.** Every instance holds a pool; `instances × pool_size` hits `max_connections` sooner than expected. PgBouncer or smaller pools.
2. **Unindexed search.** `ILIKE '%term%'` is a sequential scan. `pg_trgm` GIN, or a real full-text column.
3. **Argon2 CPU under login bursts.** Hashing is intentionally expensive; a login spike is a CPU spike. Tune the cost parameters against measured hardware.
4. **`COUNT(*)` on large filtered lists.** The exact total on every page becomes the slow part. Switch to cursor pagination or an approximate count.
5. **In-memory rate limiting** silently multiplying across instances.
6. **Synchronous work in the request path** — email, PDFs, third-party calls — holding connections open.

---

## Security decisions still specific to your application

The template makes defensible defaults. These require your product's judgement:

- **Token lifetimes.** 15 min / 7 days suits a normal web application. A banking app wants shorter; a background sync agent may want longer.
- **Account lockout.** IP rate limiting is here. Per-account lockout after N failures is a product decision — it is also a denial-of-service vector against a known email.
- **Password policy.** Length is what matters and is enforced. Rotation requirements, breach-list checks (HIBP) and MFA are yours to add.
- **Session visibility.** `RefreshSession` stores IP and user-agent so users can review their sessions — but that is personal data with retention and disclosure obligations. Drop the columns if you will not use them; storing data you do not need is a liability, not a feature.
- **Data retention and deletion.** Hard delete is the default here. GDPR/CCPA erasure and any retention requirement are jurisdiction- and domain-specific.
- **Multi-tenancy.** Not modelled. If you need it, decide early: row-level `tenantId` (simple, needs a filter everywhere — enforce it in the repository, never per-query) versus schema-per-tenant (stronger isolation, heavier migrations).
- **PII in logs.** Passwords and tokens are redacted. Whether an email address may appear in a log line is your privacy policy's call.
- **Docs exposure.** The OpenAPI document maps your entire attack surface, including which permission guards which endpoint. Consider `SWAGGER_ENABLED=false` for a private API.
