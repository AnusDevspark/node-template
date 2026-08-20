# Working in this repository

A general-purpose Express 5 + Prisma + Zod API template. **It has no business domain.**
The only resource it ships is `User`, which exists because authentication needs it and
because it doubles as the worked example for adding your own module.

Do not infer a domain from the code. If you are adding a feature, the domain comes from
the person asking — ask if it is not stated.

## Read first

- **`API-CONTRACT.md`** — the wire agreement with the `next-template` frontend. Read it
  before touching anything that changes a response shape, a status code, or an error
  code. The same file is committed to the frontend repo; change both together.
- `docs/README.md` — index of the rest.

## Layering

```
middleware → route → validate → authenticate → authorize → controller → service → repository → Prisma
```

- **Controllers** speak HTTP only. No Prisma, no business rules, and no `try/catch` —
  Express 5 forwards a rejected promise to the error handler for you.
- **Services** hold business rules and know nothing about Express. No `req`, no `res`.
- **Repositories** read and write. They never accept a request body.
- **Wiring is manual**, in `src/routes/index.ts`. Classes take collaborators through the
  constructor and never import a singleton — that is what makes them testable with a
  plain object stand-in.

## Rules that are not negotiable

- **Throw, never build a response.** One global error handler formats every failure. Use
  the classes in `src/errors/http-errors.ts`.
- **Validation is always 400**, never 422.
- **PATCH, not PUT.** `DELETE` returns 204 with no body.
- **Never spread a Prisma record into a response.** Mappers build DTOs field by field, so
  a column added later cannot leak. This is what keeps `passwordHash` server-side.
- **Zod schemas are the single definition** of each request shape. Controllers derive
  their types with `z.infer`, and the OpenAPI document is generated from the same
  objects, so docs cannot drift from validation.
- **Check permissions, not roles.** Permission *keys* live in code
  (`src/shared/constants/permissions.constant.ts`); the *grants* live in the database so
  operators can change them without a deploy.
- **Ownership rules go at the top of the service method**, not in middleware — middleware
  does not know which record is being touched. See `UserService.updateUser`.
- **Nobody may change their own role or status**, whatever permissions they hold.

## Adding a module

Copy `src/modules/user/` and follow `docs/adding-a-module.md`. A module is:

```
<name>.schema.ts      Zod request shapes (also feeds OpenAPI)
<name>.types.ts       DTOs and internal shapes
<name>.mapper.ts      entity → DTO, field by field
<name>.repository.ts  Prisma access
<name>.service.ts     business rules
<name>.controller.ts  HTTP
<name>.routes.ts      middleware chain
```

Then register it in `src/routes/index.ts`, add its permissions to the constants file and
the seed, and add paths to `src/docs/openapi.ts`.

## Verifying

```
npm run typecheck && npm run lint
npm run test              # unit, no database
npm run test:integration  # real Postgres, truncated between tests
```

Integration tests raise the rate limits (`tests/setup/integration.setup.ts`). If you run
the frontend's end-to-end suite against this API, start it with
`AUTH_RATE_LIMIT_MAX=100000` — the default of ten credential attempts per fifteen minutes
is correct for production and far too low for a suite that logs in repeatedly.
