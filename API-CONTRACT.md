# API contract

The agreement between `node-template` (the API) and `next-template` (the web client).

**This file is committed identically to both repositories.** Change it in one, copy it to
the other in the same commit. If the two copies disagree, something has already broken.

It exists because the interesting part of an integration is never the types — it is the
handful of conventions that are easy to get wrong and produce silent, confusing failures.
Those are written down here, next to the shapes they constrain.

**Enforced by:**

| Where | What it checks |
| --- | --- |
| `node-template/tests/integration/` | The API really emits these shapes |
| `next-template/src/lib/api/contract.ts` | The client's mirrored types |
| `next-template/src/lib/api/contract.test.ts` | Fixtures from this file parse correctly |
| `next-template/e2e/contract.api.spec.ts` | A live API still honours all of it |

---

## 1. Transport

| | |
| --- | --- |
| Base URL | `http://localhost:4000/api/v1` in development |
| Versioning | URL prefix only, applied in one place (`src/routes/index.ts`) |
| Auth | `Authorization: Bearer <accessToken>`. **No cookies on the API side.** |
| Content type | `application/json` |
| Field naming | camelCase end to end. No case transformation anywhere. |
| Ids | UUID v4 strings |
| Timestamps | ISO-8601 strings (`2026-08-20T16:43:08.831Z`), never `Date`, never epoch numbers |
| Date-only values | `YYYY-MM-DD`, parsed as UTC midnight |

The backend listens on **4000**, not 3000 — the Next dev server owns 3000. Both
`.env.example` files are already set up this way.

### CORS

The API allows only the origins listed in `CORS_ORIGIN` (comma-separated, exact match,
never `*`). It sends `Access-Control-Allow-Credentials: true` and exposes
`X-Request-Id`, `RateLimit`, `RateLimit-Policy` and `Retry-After`.

With `NEXT_PUBLIC_API_MODE=direct` (the default) the browser calls the API directly and
`CORS_ORIGIN` must contain the frontend's origin. With `proxy`, requests go to
`/api/bff/*` on the Next origin instead and CORS is not involved.

---

## 2. Success envelope

Every successful response is wrapped. There is no unwrapped endpoint — auth included.

```json
{
  "success": true,
  "message": "Logged in successfully.",
  "data": { }
}
```

- `message` is **omitted entirely** when the endpoint has nothing to say. It is never
  `null`. Narrow with `"message" in body`.
- `data` is always present on 2xx except **204**, which has no body at all.

### List responses

List endpoints add `meta`, and `data` is an array. `meta` appears on nothing else.

```json
{
  "success": true,
  "data": [ ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 6,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

All six `meta` keys are always present. `hasNextPage`/`hasPreviousPage` come from the
server rather than being derived by the client — the server is the authority on whether
more rows exist.

---

## 3. Error envelope

Every failure, at every status, is flat. There is no nested `error` object.

```json
{
  "success": false,
  "message": "Validation failed",
  "code": "VALIDATION_FAILED",
  "errors": [{ "field": "pageSize", "message": "pageSize cannot exceed 100" }],
  "requestId": "899aed0e-8a43-4a5c-8a96-967247d289fb"
}
```

| Field | When present |
| --- | --- |
| `success` | Always `false` |
| `message` | Always. Human-readable prose — **do not branch on it** |
| `code` | Where a client would reasonably branch. See the table below |
| `errors` | Validation failures, and conflicts that concern a specific field |
| `requestId` | Always. Also echoed as the `x-request-id` response header |
| `stack` | **Non-production only.** Never render it |

### Error codes

Branch on `code`, never on `message`. Messages are prose and change without notice.

| Code | Status | What the client should do |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | Show the message |
| `VALIDATION_FAILED` | 400 | Map `errors` onto form fields |
| `AUTH_TOKEN_MISSING` | 401 | Attempt a refresh, then redirect to login |
| `AUTH_TOKEN_EXPIRED` | 401 | Attempt a refresh, then retry the request |
| `AUTH_TOKEN_INVALID` | 401 | Attempt a refresh, then redirect to login |
| `AUTH_INVALID_CREDENTIALS` | 401 | Show "wrong email or password". **Do not refresh** |
| `AUTH_ACCOUNT_DISABLED` | 401 | Redirect to login with an explanation. **Do not refresh** |
| `AUTH_SESSION_REVOKED` | 401 | Force a full re-login. **Do not refresh** |
| `FORBIDDEN` | 403 | Show "no access". Never a refresh trigger |
| `PERMISSION_DENIED` | 403 | Show "no permission" |
| `NOT_FOUND` | 404 | Show a not-found state, offer no retry |
| `CONFLICT` | 409 | Map `errors` onto the field if present, else show the message |
| `RATE_LIMITED` | 429 | Back off; read `Retry-After` |
| `INTERNAL_ERROR` | 500 | Generic message. **Never show the body verbatim** |
| `SERVICE_UNAVAILABLE` | 503 | Health endpoints only. Retry is sensible |

The three codes marked "do not refresh" are terminal: the session cannot be recovered, so
a refresh round trip only delays the inevitable redirect. The client encodes this as
`TERMINAL_AUTH_CODES` in `src/lib/api/contract.ts`.

### Field errors

A flat array, never a map:

```json
"errors": [
  { "field": "email", "message": "This email is already in use" },
  { "field": "items.0.name", "message": "Name is required" }
]
```

- `field` is a **dot-joined path** into the request. Array indices are dots, not brackets
  (`items.0.name`).
- When the failure is about the request root rather than one field — an object refinement
  such as "at least one field must be provided" — `field` is the source name instead:
  `body`, `query` or `params`.
- Validation collects errors from `params`, `query` **and** `body` before responding, so
  one 400 can mix all three.

The client maps these with `applyApiErrorsToForm`, which strips a leading `body.` prefix
and converts bracket indices. Anything it cannot match to a known field becomes a
form-level message rather than being dropped.

---

## 4. Conventions that are easy to get wrong

These are the ones that cause silent breakage. Each is asserted by a test.

1. **Validation failures are always 400.** This API never uses 422. One convention means
   clients need one branch.
2. **Updates are PATCH.** There are no PUT routes; a PUT gets a 404 from the router.
3. **DELETE returns 204** with an empty body. The client's `readJson` returns `undefined`
   rather than throwing.
4. **Bulk creates** are `POST /things/import`, returning 201 and an array, all-or-nothing
   in one transaction.
5. **`pageSize` above the maximum is a 400, not a clamp.** The client clamps to the same
   number before sending so this is never hit by accident.
6. **An unlisted `sortBy` is a 400**, never a silent fallback. Sortable fields are
   whitelisted per module, so do not offer a sortable column the API does not support.
7. **Expired tokens are 401, never 403.** Only a 401 triggers refresh-and-retry; a 403
   here would log the user out instead of refreshing them.
8. **`message` is omitted, not null**, when absent.
9. **`meta` exists only on list endpoints.**
10. **Filters are named explicitly.** The query object is never forwarded whole; an
    unrecognised parameter is ignored, not passed to the database.

---

## 5. Pagination, filtering, sorting

| Parameter | Default | Notes |
| --- | --- | --- |
| `page` | `1` | **One-indexed on both sides.** No conversion needed |
| `pageSize` | `20` | Max **100**; above that is a 400 |
| `search` | — | Case-insensitive, matches across name and email. Unindexed |
| `sortBy` | per module | Whitelisted. An unlisted value is a 400 |
| `sortOrder` | `desc` | `asc` \| `desc` |

Per-module filters are added on top. For `/users`: `status`
(`ACTIVE｜INACTIVE｜SUSPENDED`) and `role`. Sortable: `firstName`, `lastName`, `email`,
`status`, `createdAt`.

---

## 6. Authentication

Stateless HS256 access token plus a database-backed, rotating refresh token.

| | |
| --- | --- |
| Access token TTL | 15 minutes (`JWT_ACCESS_EXPIRES_IN`) |
| Refresh token TTL | 7 days (`JWT_REFRESH_EXPIRES_IN`) |
| Transport | `Authorization: Bearer <accessToken>` |
| Refresh transport | **JSON body**, not a cookie |

### The handshake

```
POST /auth/login   { email, password }
  → 200 { success, message, data: { user, tokens } }

… Authorization: Bearer <accessToken> on every request …

  → 401 AUTH_TOKEN_EXPIRED
POST /auth/refresh { refreshToken }
  → 200 { success, message, data: { user, tokens } }   ← both tokens are NEW
… retry the original request …

POST /auth/logout  { refreshToken, allDevices? }
  → 204
```

`login`, `register` and `refresh` all return the same `{ user, tokens }` payload:

```json
{
  "success": true,
  "message": "Logged in successfully.",
  "data": {
    "user": {
      "id": "1a0ba0f0-441a-40f5-87d7-793c217b9349",
      "firstName": "Admin",
      "lastName": "User",
      "fullName": "Admin User",
      "email": "admin@example.com",
      "status": "ACTIVE",
      "role": "SUPER_ADMIN",
      "permissions": ["ROLE_MANAGE", "USER_CREATE", "USER_DELETE", "USER_EDIT", "USER_VIEW"],
      "createdAt": "2026-08-20T16:43:08.831Z",
      "updatedAt": "2026-08-20T16:43:08.831Z"
    },
    "tokens": {
      "accessToken": "eyJ…",
      "refreshToken": "eyJ…",
      "expiresIn": 900,
      "tokenType": "Bearer"
    }
  }
}
```

- `expiresIn` is **seconds**, not milliseconds.
- Tokens live under `data.tokens`. There is no flat `{ accessToken, user }` form.

### Rotation and replay

Every refresh issues a new pair and revokes the token presented, so a refresh token is
usable exactly once. Presenting an already-rotated token means it was captured — the API
cannot tell whether the attacker or the victim is holding it, so it **revokes the entire
rotation family** and both must log in again (401 `AUTH_SESSION_REVOKED`).

**The client must therefore refresh single-flight.** Two concurrent refreshes race, the
loser replays a consumed token, and the user's session is destroyed. `client-api.ts`
enforces this with one shared promise.

### Logout

`POST /auth/logout` takes `{ refreshToken }` **in the body** and runs without the
authenticate middleware, so signing out still works once the access token has expired —
which is exactly when people click "sign out". Posting an empty body gets a 400 and
revokes nothing, leaving the refresh token live for its full lifetime. That failure is
invisible from the UI, so it is worth a test (there is one).

### The session user

`GET /auth/me` returns the same user object, in a plain success envelope with no tokens.

`permissions` is the caller's own permission keys, resolved from their role at request
time. The client needs them to decide what to render. **This is UX only** — the API
re-checks every permission on every request regardless of what the client believes.

`role` is a **single string**, not an array. The data model is one role per user.
Authorization decisions use `permissions`; `role` is for display.

### Cookies (frontend only)

The API sets no cookies. The Next.js BFF does, on its own origin:

| Cookie | Contents | Flags |
| --- | --- | --- |
| `acme_at` | Access token | `httpOnly`, `sameSite=lax`, `secure` in production |
| `acme_rt` | Refresh token | Same, `maxAge` 30 days by default |

Names come from `AUTH_ACCESS_COOKIE` / `AUTH_REFRESH_COOKIE`.

---

## 7. Request tracing and rate limits

- Send `X-Request-Id` to correlate a request; it must match `^[\w.:-]{1,128}$` or it is
  replaced with a fresh UUID. It is **always** echoed on the response and repeated as
  `requestId` in every error body. Log it — it is what makes a production report
  actionable.
- Rate limit headers are draft-7: `RateLimit`, `RateLimit-Policy`, plus `Retry-After` on a
  429. All are in the CORS allow-list, so browser code can read them.
- Two limiters: a general one (300 per 15 min, `/health` exempt) and a strict credential
  one (10 per 15 min on login/register/refresh/change-password, counting failures only).
- **The credential limiter will break an end-to-end suite that logs in per test.** Raise
  `AUTH_RATE_LIMIT_MAX` when running one, the way the backend's own integration setup
  does.

The limiter store is in-memory and therefore **per process**. With N instances the
effective limit is N times what is configured. Swap in a shared store before scaling out.

---

## 8. Changing the contract

1. Change the API, and its integration tests.
2. Update this file — in **both** repositories.
3. Update `next-template/src/lib/api/contract.ts` and its fixtures in `contract.test.ts`.
4. Run `E2E_API_READY=true npx playwright test contract` against the running API.

If a change cannot be made backwards-compatibly, add `/api/v2` rather than breaking v1.
The version prefix is applied in exactly one place, so a second version is cheap.
