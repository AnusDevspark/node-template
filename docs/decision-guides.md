# Decision guides

Lookup tables, plus the rules behind them.

---

## Where does this code go?

| You are writing                                  | It belongs in                 | Never in                                  |
| ------------------------------------------------ | ----------------------------- | ----------------------------------------- |
| Reading `req` / writing `res`                    | Controller                    | Service, repository                       |
| Choosing a status code                           | Nowhere — throw a typed error | Anywhere                                  |
| A business rule ("cannot book in the past")      | Service                       | Controller, repository, schema            |
| A Prisma query                                   | Repository                    | Controller, service                       |
| Shape of a request ("must be a UUID")            | Zod schema                    | Controller                                |
| "Is this caller allowed?" by role or permission  | Authorization middleware      | Controller                                |
| "Is this caller allowed to touch _this record_?" | Service                       | Middleware — it has not loaded the record |
| Entity → API shape                               | Mapper                        | Controller                                |
| Something two modules need                       | `shared/`                     | One module importing another's internals  |
| Constructing dependencies                        | `src/routes/index.ts`         | Module files                              |
| Cross-cutting HTTP behaviour                     | `src/middleware/`             | Individual routes                         |

---

## Which error do I throw?

| Situation                                             | Error                                       | Status |
| ----------------------------------------------------- | ------------------------------------------- | ------ |
| Malformed input that Zod did not catch                | `BadRequestError`                           | 400    |
| Field-level validation failure                        | `ValidationError`                           | 400    |
| No token, bad token, expired token, wrong credentials | `UnauthorizedError`                         | 401    |
| Authenticated but lacking permission or ownership     | `ForbiddenError`                            | 403    |
| Record does not exist                                 | `NotFoundError`                             | 404    |
| Duplicate, or a state conflict ("already cancelled")  | `ConflictError`                             | 409    |
| Rate limit exceeded                                   | `TooManyRequestsError`                      | 429    |
| A bug                                                 | Throw anything — the handler makes it a 500 | 500    |

**401 vs 403:** 401 means "I do not know who you are"; 403 means "I know who you are and the answer is no."

**404 vs 403 for a record you may not see:** returning 403 confirms the record exists. Prefer 404 when that existence is itself sensitive.

**Validation is always 400.** This API does not use 422 — one convention means one branch in every client.

---

## Which auth middleware?

| Need                                     | Use                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Must be signed in                        | `authenticate`                                                          |
| Signed in **and** holds a permission     | `authenticate` + `requirePermission(P)`                                 |
| Holds **any one** of several permissions | `requireAnyPermission(A, B)`                                            |
| Must have a specific role                | `authorizeRoles('ADMIN')` — but prefer permissions                      |
| May edit only their own record           | `authenticate`, then the ownership check **in the service**             |
| Richer data when signed in, still public | `optionalAuthenticate`                                                  |
| Fully public                             | No auth middleware; declare the route before `router.use(authenticate)` |

Prefer `requirePermission` over `authorizeRoles`. A role check hardcodes policy into code; a permission check leaves it in the database where an operator can change it without a deploy.

Ownership cannot live in middleware — middleware does not know which record is being touched and should not be loading records.

---

## Which validation piece?

| Field                          | Use                                                            |
| ------------------------------ | -------------------------------------------------------------- |
| `/:id` path param              | `uuidParamSchema`                                              |
| `page` / `pageSize`            | `paginationSchema`                                             |
| `sortBy` / `sortOrder`         | `sortingSchema(MODULE_SORT_FIELDS, 'default')`                 |
| `search`                       | `searchSchema`                                                 |
| Email                          | `emailSchema` (trims + lowercases)                             |
| New password                   | `passwordSchema`                                               |
| Existing password at login     | `z.string().min(1).max(128)` — **never** the policy            |
| Person name                    | `personNameSchema`                                             |
| `?flag=true` in a query string | `booleanQueryParam`                                            |
| Number in a query string       | `z.coerce.number()`                                            |
| Date only (birthday)           | Regex + explicit UTC construction — see `common.schema.ts`   |
| Date and time                  | `z.iso.datetime({ offset: true }).transform(v => new Date(v))` |
| Prisma enum                    | `z.enum(TheEnum)`                                              |
| Cross-field rule               | `.refine(...)` on the object                                   |

Compose with `.extend(other.shape)`. Do not build schema factories — normal schemas stay inferable and readable.

---

## Do I need a mapper?

| The model has                               | Mapper?                                   |
| ------------------------------------------- | ----------------------------------------- |
| A secret field (`passwordHash`, a token)    | **Yes, always**                           |
| An internal field (cost, vendor id, a flag) | **Yes**                                   |
| A `Date`                                    | Yes — otherwise serialisation is implicit |
| A joined relation to flatten                | Yes                                       |
| A derived value (`fullName`, `endsAt`)      | Yes                                       |
| Only public, already-serialisable scalars   | Optional                                  |

Write the mapper anyway if the model will grow. The habit is what prevents the leak; the exception is what causes it.

**Always build the object field by field.** `return { ...record }` leaks the next column someone adds.

---

## Do I need a transaction?

| Situation                                              | Transaction?                                           |
| ------------------------------------------------------ | ------------------------------------------------------ |
| One `create` / `update` / `delete`                     | No — already atomic                                    |
| Two writes that must both succeed                      | **Yes**                                                |
| A write plus a related revocation (password change)    | **Yes**                                                |
| `findMany` + `count` for one page                      | Yes — already done in the repositories                 |
| A read, then a write based on it, where a race matters | Yes — plus a unique constraint                         |
| Anything involving an HTTP call                        | **No.** Never hold a transaction across a network call |

The service opens it; repositories accept `tx`. Keep it short.

---

## Where do I put a shared thing?

| It is                                     | Put it in                                         |
| ----------------------------------------- | ------------------------------------------------- |
| Used by 2+ modules, no business knowledge | `src/shared/utils/`                               |
| A reusable Zod piece                      | `src/shared/validation/common.schema.ts`          |
| A constant referenced across modules      | `src/shared/constants/`                           |
| A cross-cutting HTTP concern              | `src/middleware/`                                 |
| Talking to an external system             | `src/infrastructure/<thing>/` behind an interface |
| Used by exactly one module                | That module — **not** `shared/`                   |

`shared/` must never import a feature module. If it needs to, it is not shared.

**Do not create `utils.ts`, `helpers.ts` or `common.ts`.** Name the file after what it does: `pagination.util.ts`, `token-hash.util.ts`.

---

## Should I build this abstraction?

| Thought                                                        | Answer                                                                                                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| "All my repositories share CRUD — extract `BaseRepository<T>`" | No. Five one-line methods are not duplication worth a generic. Filtering and sorting, the part that differs, is what you would be forcing to agree |
| "A `BaseController` would DRY these up"                        | No. Controllers are three lines each; a base class hides the one thing a reader wants                                                              |
| "An event bus would decouple these"                            | Only when a **second** consumer exists. One consumer means invisible control flow for no benefit                                                   |
| "I'll add a cache"                                             | Only after profiling names the query. A cache is a second source of truth and an invalidation bug                                                  |
| "Redis would help"                                             | When you run 2+ instances (shared rate limiting), or you need a job queue. Not before                                                              |
| "A repository interface would let me swap the ORM"             | No. You will not swap the ORM. The class is already the seam                                                                                       |
| "This service is getting long"                                 | Split by **use case**, not one-class-per-method. `TaskBookingService` + `TaskScheduleService` beats twelve classes                   |

The test: **does removing it make the code worse?** If not, do not add it.

---

## What to keep and what to cut

Starting a small project from this template:

| Piece                            | Keep?                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Env validation                   | **Always.** Smallest piece, prevents the worst class of outage                                                              |
| Error classes + global handler   | **Always**                                                                                                                  |
| Response helpers                 | **Always.** Consistency is the whole value                                                                                  |
| Zod validation middleware        | **Always.** This is the security boundary                                                                                   |
| Mappers                          | **Always**                                                                                                                  |
| Request IDs + structured logging | **Always.** Retrofitting is painful                                                                                         |
| Graceful shutdown                | **Always.** Twenty lines, prevents dropped requests on every deploy                                                         |
| Health endpoints                 | Keep if containerised                                                                                                       |
| Auth module                      | Keep unless genuinely public                                                                                                |
| Refresh rotation + families      | Keep rotation and hashing. Family revocation is droppable for low-risk apps                                                 |
| DB-backed RBAC                   | Cut for a small app — a role enum and `authorizeRoles` is fine. Keep the permission _call sites_ so upgrading is mechanical |
| OpenAPI                          | Cut if you own both ends and dislike maintaining it                                                                         |
| Integration tests                | **Keep the harness** even if you write few tests                                                                            |

Becomes important at scale: shared rate-limit store, read replicas, background workers, caching, `pg_trgm` search, cursor pagination, metrics and tracing.

---

## Which test?

| Testing                                       | Kind                    | Where                |
| --------------------------------------------- | ----------------------- | -------------------- |
| A business rule in isolation                  | Unit, mocked repository | `tests/unit/`        |
| A mapper or utility                           | Unit                    | `tests/unit/`        |
| Status codes, envelopes, middleware order     | Integration             | `tests/integration/` |
| Permissions and ownership                     | Integration             | `tests/integration/` |
| A database constraint or transaction rollback | Integration             | `tests/integration/` |
| The auth token lifecycle                      | Integration             | `tests/integration/` |

Rule of thumb: **rules → unit, wiring → integration.** If a test needs three mocks to express one rule, it probably wants to be an integration test.

---

## HTTP conventions

| Action            | Method                    | Success               |
| ----------------- | ------------------------- | --------------------- |
| List              | `GET /things`             | 200 + `data` + `meta` |
| Read one          | `GET /things/:id`         | 200 + `data`          |
| Create            | `POST /things`            | 201 + `data`          |
| Partial update    | `PATCH /things/:id`       | 200 + `data`          |
| Delete            | `DELETE /things/:id`      | 204, no body          |
| Business action   | `POST /things/:id/<verb>` | 200 + `data`          |
| Bulk atomic write | `POST /things/import`     | 201 + `data` array    |

`PATCH`, not `PUT` — clients send partial updates in practice, and `PUT` implies full replacement.
