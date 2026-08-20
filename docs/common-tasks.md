# Common tasks

Recipes. For a whole new resource see [adding-a-module.md](./adding-a-module.md).

---

## Add an environment variable

1. `.env.example` — add it with a comment explaining what it does and what happens if it is wrong.
2. `src/config/env.ts` — add it to `envSchema`.
3. `.env` — set it locally.

```ts
// src/config/env.ts
const envSchema = z.object({
  // …
  STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY is required'),
  FEATURE_BILLING: booleanFromString.default(false),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(10),
});
```

Then `env.STRIPE_SECRET_KEY` is typed everywhere. **Never read `process.env` outside this file** — that is what guarantees a misconfigured deploy dies at boot instead of at 3am.

Environment values are strings, so use `z.coerce.number()` for numbers and the existing `booleanFromString` for flags.

For a value required only in production:

```ts
.superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production' && !value.STRIPE_SECRET_KEY) {
    ctx.addIssue({ code: 'custom', message: 'STRIPE_SECRET_KEY is required in production' });
  }
});
```

---

## Add a permission

```ts
// src/shared/constants/permissions.constant.ts
export const PERMISSIONS = {
  // …
  REPORT_EXPORT: 'REPORT_EXPORT',
} as const;

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  // …
  REPORT_EXPORT: 'Export reports as CSV', // compile error if you forget
};

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, PermissionKey[]> = {
  [ROLES.SUPER_ADMIN]: ALL_PERMISSIONS,
  [ROLES.ADMIN]: [/* … */ PERMISSIONS.REPORT_EXPORT],
  [ROLES.USER]: [/* … */],
};
```

```bash
npm run prisma:seed   # adds the permission and the grants; removes nothing
```

Use it: `requirePermission(PERMISSIONS.REPORT_EXPORT)`.

> Grants are cached in-process for 60 seconds (`RbacService`). After changing them in the database directly, either wait a minute or restart. `npm run prisma:seed` + restart is the reliable path.

---

## Add a role

```ts
// src/shared/constants/roles.constant.ts
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  SUPPORT: 'SUPPORT',
  USER: 'USER',
} as const;

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  // …
  SUPPORT: 'Read-only access for the support desk',
};
```

Then grant it permissions in `DEFAULT_ROLE_PERMISSIONS` and re-seed.

Roles live in the database, so an operator can also create one at runtime without touching this file. The constant exists only so _code_ can reference a known role safely.

---

## Add a filter to an existing list endpoint

Three places, all in the same module. Say you want `?activeWithinDays=30` on users — "show
me people who have done something in the last month".

**1. Schema** — declare it:

```ts
// user.schema.ts
export const listUsersQuerySchema = paginationSchema
  .extend(sortingSchema(USER_SORT_FIELDS, 'createdAt').shape)
  .extend(searchSchema.shape)
  .extend({
    status: z.enum(UserStatus).optional(),
    role: z.string().trim().max(50).optional(),
    activeWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  });
```

**2. Filter type + `where`** — teach the repository:

```ts
// user.types.ts
export interface UserListFilters {
  search?: string;
  status?: UserStatus;
  role?: string;
  /** The repository speaks in timestamps, not in "days ago". */
  updatedAfter?: Date;
}

// user.repository.ts
private buildWhere(filters: UserListFilters) {
  return {
    ...omitUndefined({
      status: filters.status,
      role: filters.role ? { name: filters.role } : undefined,
      updatedAt: filters.updatedAfter ? { gte: filters.updatedAfter } : undefined,
    }),
    ...buildSearchFilter(USER_SEARCH_FIELDS, filters.search),
  };
}
```

**3. Service** — translate the request into the filter:

```ts
const updatedAfter = query.activeWithinDays
  ? new Date(Date.now() - query.activeWithinDays * 24 * 60 * 60 * 1000)
  : undefined;

const { items, total } = await this.userRepository.findMany(
  { search: query.search, status: query.status, role: query.role, updatedAfter },
  pagination,
  query.sortBy,
  query.sortOrder,
);
```

Note the shape: the **API** speaks `activeWithinDays` (what a person asking the question
thinks), the **repository** speaks `updatedAfter` (what the column holds), and the
**service** translates between them. Never forward `req.query` wholesale.

If the filter will be used often, index the column.

---

## Add a sortable field

One line — but check there is an index:

```ts
export const USER_SORT_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'status',
  'createdAt',
  'updatedAt', // new
] as const;
```

The schema validates against this tuple and the repository whitelists against it, so an unknown value is a 400. Sorting an unindexed column on a large table is a full sort — add `@@index([updatedAt])` if it will be common.

---

## Add a non-CRUD action

Anything with rules ("approve", "cancel", "deactivate", "resend") is an endpoint, not a PATCH field.

```ts
// user.schema.ts
export const suspendUserSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

// user.service.ts
async suspendUser(id: string, reason: string, actor: AuthenticatedUser): Promise<UserResponse> {
  const target = await this.userRepository.findById(id);
  if (!target) throw new NotFoundError('User not found');
  if (target.status === UserStatus.SUSPENDED) {
    throw new ConflictError('User is already suspended');
  }
  // Locking yourself out is never the intent.
  if (target.id === actor.id) {
    throw new ForbiddenError('You cannot suspend your own account');
  }

  const updated = await this.userRepository.update(id, { status: UserStatus.SUSPENDED });
  logger.info({ userId: id, actorId: actor.id, reason }, 'user suspended');
  return mapUserToResponse(updated);
}

// user.controller.ts
suspendUser = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as UserIdParam;
  const { reason } = req.body as SuspendUserInput;
  const actor = requireAuthenticatedUser(req);
  sendSuccess(res, await this.userService.suspendUser(id, reason, actor), 'User suspended.');
};

// user.routes.ts
router.post(
  '/:id/suspend',
  requirePermission(PERMISSIONS.USER_EDIT),
  validate({ params: userIdParamSchema, body: suspendUserSchema }),
  controller.suspendUser,
);
```

Why not `PATCH { status: "SUSPENDED" }`: the endpoint can require a reason, enforce
preconditions, refuse self-suspension, use a distinct permission, and be logged and
audited as a specific event. A PATCH would skip every one of those.

---

## Run several writes atomically

The service owns the transaction; repositories accept the client.

```ts
const result = await this.prisma.$transaction(async (tx) => {
  const invoice = await this.invoiceRepository.create({/* … */}, tx);
  await this.ledgerRepository.appendEntry({ invoiceId: invoice.id }, tx);
  return invoice;
});
```

Rules:

- **Throwing inside the callback rolls everything back.** That is the mechanism — do not catch and continue.
- **Pass `tx` to every repository call inside**, or that call runs outside the transaction and will not roll back.
- **Keep it short.** A transaction holds locks and a pooled connection. Never do an HTTP request inside one.
- Inject `prisma` into the service constructor (see `UserService`).

`AuthService.changePassword` is a working example: it rewrites the password and revokes every other session in one transaction, and an integration test proves the rollback.

---

## Add a database index

```prisma
model Task {
  // …
  @@index([assigneeId, startsAt])
}
```

```bash
npm run prisma:migrate
```

Add one when a query filters or sorts by that column often. **Do not index everything** — each index slows writes and costs storage. Confirm with real data:

```sql
EXPLAIN ANALYZE SELECT * FROM users WHERE role_id = '…' AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 20;
```

`Seq Scan` on a large table means you want an index. Composite index column order matters: put the equality-filtered column first, the sorted one second.

On a large production table, create the index concurrently to avoid locking writes — edit the generated migration SQL:

```sql
CREATE INDEX CONCURRENTLY "tasks_assignee_id_starts_at_idx" ON "tasks"("assignee_id", "starts_at");
```

---

## Change the password policy

`src/shared/validation/common.schema.ts` — `passwordSchema` is the single definition, used by register, admin-create and change-password.

```ts
export const passwordSchema = z
  .string()
  .min(12, 'password must be at least 12 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'password must contain at least one letter')
  .regex(/\d/, 'password must contain at least one number');
```

**Do not add it to the login schema.** Login accepts any non-empty string on purpose: validating an existing password against current rules locks out users whose password predates the change, and the rejection message leaks your policy.

Existing hashes stay valid — Argon2 reads its parameters from the hash string.

---

## Make hashing stronger

```bash
ARGON2_MEMORY_COST=32768   # KiB — raise this first, it costs attackers most
ARGON2_TIME_COST=3
```

Old hashes keep verifying at their original cost. Measure before raising: hashing is deliberately slow, and a login burst is a CPU burst.

---

## Change token lifetimes

```bash
JWT_ACCESS_EXPIRES_IN=5m    # shorter = smaller window for a stolen token
JWT_REFRESH_EXPIRES_IN=30d  # longer = fewer logins
```

Access tokens **cannot be revoked** — that is why they are short. Refresh tokens are database-backed and revocable, so a longer life is safe.

Note this template re-checks account status from the database on every authenticated request, so suspending a user takes effect immediately regardless of the access lifetime.

---

## Send a real email

`ConsoleEmailService` logs instead of sending. Add a real implementation next to it:

```ts
// src/modules/auth/email.service.ts
export class ResendEmailService implements EmailService {
  constructor(private readonly apiKey: string) {}

  async send(options: SendEmailOptions): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'noreply@yourdomain.com',
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      }),
    });

    if (!response.ok) {
      throw new Error(`Email delivery failed: ${response.status}`);
    }
  }

  async sendPasswordReset(to: string, resetToken: string): Promise<void> {
    /* … */
  }
  async sendEmailVerification(to: string, token: string): Promise<void> {
    /* … */
  }
}
```

One line in `src/routes/index.ts`:

```ts
const emailService = env.isProduction
  ? new ResendEmailService(env.RESEND_API_KEY)
  : new ConsoleEmailService();
```

Nothing in `AuthService` changes — that is the point of the interface.

> Sending inline makes the request wait on a third party. Once it matters, queue it. See [architecture.md](./architecture.md#background-jobs--srcjobs-and-srcworkers).

---

## Add a public (unauthenticated) endpoint

Just leave `authenticate` off that route. Note the module-wide `router.use(authenticate)` — a public route must be declared before it, or in a router that does not apply it.

```ts
export function createUserRouter({ controller, authenticate, requirePermission }) {
  const router = Router();

  // Public — declared BEFORE the authenticate guard.
  router.get('/public/specialities', controller.getSpecialities);

  router.use(authenticate);
  // …everything below requires a token
}
```

Public endpoints still get validation, rate limiting and the error envelope. Consider a stricter limiter and be careful what you expose — a public list endpoint is a scraping target.

---

## Return richer data to signed-in callers on a public route

Use the optional authenticator, which attaches `req.user` when a token is present and does nothing otherwise:

```ts
// src/routes/index.ts
const optionalAuthenticate = createOptionalAuthenticate(userRepository);
```

```ts
// in the controller
const user = getCurrentUser(req); // undefined when anonymous
const data = await this.service.list({ includePrivateFields: Boolean(user) });
```

Never use it on a route that must be protected.

---

## Add a health check for a new dependency

```ts
// src/modules/health/health.controller.ts
ready = async (_req: Request, res: Response): Promise<void> => {
  const [database, cache] = await Promise.all([isDatabaseReachable(), isCacheReachable()]);
  const healthy = database && cache;

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: {
      status: healthy ? 'ready' : 'not_ready',
      checks: {
        database: database ? 'up' : 'down',
        cache: cache ? 'up' : 'down',
      },
    },
  });
};
```

Add it to **readiness**, never liveness. A liveness probe that depends on an external service turns a brief outage into a restart storm across every instance.

---

## Change pagination defaults

```ts
// src/shared/utils/pagination.util.ts
export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 100,
} as const;
```

Applies everywhere. Raise `MAX_PAGE_SIZE` reluctantly — it is the cap that stops `?pageSize=1000000` becoming a free table scan.

---

## Add a machine-readable error code

```ts
// src/errors/app-error.ts
export const ERROR_CODES = {
  // …
  TASK_SLOT_TAKEN: 'TASK_SLOT_TAKEN',
} as const;
```

```ts
throw new AppError('This slot is no longer available', 409, {
  code: ERROR_CODES.TASK_SLOT_TAKEN,
});
```

Add a code when a client must **branch** on it — offer alternative slots, show a re-verify button, silently refresh. If the client would only display `message`, skip it; codes you invent for tidiness become a vocabulary nobody maintains.

---

## Rate limit one endpoint more strictly

```ts
import rateLimit from 'express-rate-limit';

const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new TooManyRequestsError()),
});

router.post('/export', authenticate, exportLimiter, requirePermission(...), controller.export);
```

Remember the limiter store is **in-memory, per process**. With N instances the real limit is N×. See [architecture.md](./architecture.md) for the Redis swap.

---

## Log something useful

```ts
import { logger } from '@/config/logger';

logger.info({ assigneeId, userId: actor.id }, 'user deactivated');
logger.warn({ userId }, 'repeated failed login');
logger.error({ err: error, invoiceId }, 'invoice generation failed');
```

- Structured fields as the **first** argument, message second. `logger.info({ userId }, 'x')`, not string interpolation — the fields are what you search on.
- Errors go under the key `err` so Pino serialises the stack.
- `console.log` is blocked by ESLint in `src/`.
- Never log passwords, tokens, or auth headers. The logger redacts known keys, but that is a backstop, not permission.

---

## Debug a production request

Every response carries `X-Request-Id`, and errors include `requestId` in the body. Ask the user for it, then:

```bash
grep '"reqId":"<id>"' app.log | jq
```

You get the request line, any warnings, and the error with its stack — all correlated. If a client sends its own `X-Request-Id`, it is reused, so a trace can span several services.

---

## Reset the database

```bash
# development only — destroys all data, then re-migrates and re-seeds
npx prisma migrate reset

# nuclear: also removes the container volume
docker compose down -v && docker compose up -d postgres && npm run db:wait
npm run prisma:migrate && npm run prisma:seed
```

Never on a database with data you care about.

---

## Deploy

```bash
npm ci
npm run build
npm run prisma:migrate:deploy   # SEPARATE release step, before rolling out
npm start
```

`migrate deploy` applies existing migrations without prompting or generating. Run it **once** as a release step — not on container start, or every replica races.

The Dockerfile builds a multi-stage image running as a non-root user with `tini` as PID 1 so `SIGTERM` reaches Node and graceful shutdown runs.

Check the [production checklist](../README.md#production-checklist) before your first deploy.
