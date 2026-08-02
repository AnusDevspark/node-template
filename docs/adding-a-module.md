# Adding a module

A complete worked example: an **Appointment** module.

Every file below was written, compiled, migrated and exercised against a running server before being pasted here. Copy it verbatim and it works.

Appointment is a good example because it needs things Provider does not demonstrate: a **foreign key** to another module, an **enum filter**, a **date-range filter**, real **business rules**, and a **non-CRUD action** (cancel).

---

## Step 0 — Answer these first

Deciding before writing is what keeps a module small.

| #   | Question                               | For Appointment                                                       |
| --- | -------------------------------------- | --------------------------------------------------------------------- |
| 1   | Is this standard CRUD?                 | Mostly — plus one business action                                     |
| 2   | Does it reference another module?      | Yes, `Provider` — use its **repository**, never its internals         |
| 3   | What can a client filter by?           | `status`, `providerId`, a date range, free-text search                |
| 4   | What can a client sort by?             | `scheduledAt`, `patientName`, `status`, `createdAt`                   |
| 5   | Does the response differ from the row? | Yes — flatten the provider name, derive `endsAt` → **needs a mapper** |
| 6   | Are there non-CRUD actions?            | Cancel — its own endpoint and its own permission                      |
| 7   | Any field a client must **not** set?   | `status`. Cancelling has rules; a PATCH would skip them               |
| 8   | Hard or soft delete?                   | Hard — `status: CANCELLED` is the real "undo"                         |
| 9   | Which permissions?                     | `APPOINTMENT_VIEW/CREATE/EDIT/CANCEL/DELETE`                          |
| 10  | Does anything need a transaction?      | No — every operation is a single write                                |

Question 7 is the one people skip. **If an action has rules, it is not a field.**

---

## Step 1 — Schema

`prisma/schema.prisma` — add the enum and model, and the back-relation on `Provider`:

```prisma
enum AppointmentStatus {
  SCHEDULED
  COMPLETED
  CANCELLED
}

model Appointment {
  id String @id @default(uuid()) @db.Uuid

  providerId String   @db.Uuid
  provider   Provider @relation(fields: [providerId], references: [id], onDelete: Restrict)

  patientName  String @db.VarChar(200)
  patientEmail String @db.VarChar(255)

  scheduledAt     DateTime
  durationMinutes Int               @default(30)
  status          AppointmentStatus @default(SCHEDULED)
  notes           String?           @db.VarChar(1000)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([providerId, scheduledAt]) // "this provider's diary" — the main query
  @@index([status])
  @@index([scheduledAt])
  @@map("appointments")
}
```

And inside `model Provider`:

```prisma
  appointments Appointment[]
```

Three decisions worth stating:

- **`onDelete: Restrict`** — deleting a provider who has appointments should fail loudly, not silently destroy history. Prisma raises `P2003`, which the error mapper turns into a 400.
- **`@@index([providerId, scheduledAt])`** is composite because the dominant query filters by provider _and_ orders by time. Two separate indexes would not serve it as well.
- **No `endsAt` column.** It is `scheduledAt + durationMinutes`; storing it invites the two disagreeing.

```bash
npm run prisma:migrate    # name it: add_appointments
```

`prisma generate` runs automatically, so `AppointmentStatus` is importable immediately.

---

## Step 2 — Permissions

`src/shared/constants/permissions.constant.ts`:

```ts
export const PERMISSIONS = {
  // …
  APPOINTMENT_VIEW: 'APPOINTMENT_VIEW',
  APPOINTMENT_CREATE: 'APPOINTMENT_CREATE',
  APPOINTMENT_EDIT: 'APPOINTMENT_EDIT',
  // Cancelling is separate from editing on purpose: front-desk staff often may
  // cancel without being allowed to rewrite patient details.
  APPOINTMENT_CANCEL: 'APPOINTMENT_CANCEL',
  APPOINTMENT_DELETE: 'APPOINTMENT_DELETE',
} as const;
```

Add descriptions to `PERMISSION_DESCRIPTIONS` (the type makes this mandatory — a missing key is a compile error), then grant them:

```ts
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, PermissionKey[]> = {
  [ROLES.SUPER_ADMIN]: ALL_PERMISSIONS,
  [ROLES.ADMIN]: [
    // …
    PERMISSIONS.APPOINTMENT_VIEW,
    PERMISSIONS.APPOINTMENT_CREATE,
    PERMISSIONS.APPOINTMENT_EDIT,
    PERMISSIONS.APPOINTMENT_CANCEL,
    PERMISSIONS.APPOINTMENT_DELETE,
  ],
  [ROLES.USER]: [
    PERMISSIONS.PROVIDER_VIEW,
    PERMISSIONS.APPOINTMENT_VIEW,
    PERMISSIONS.APPOINTMENT_CREATE,
  ],
};
```

```bash
npm run prisma:seed   # idempotent: adds new grants, never removes existing ones
```

---

## Step 3 — Types

`src/modules/appointment/appointment.types.ts`

```ts
import type { AppointmentStatus } from '@/generated/prisma/enums';

/** What the API returns. Note it exposes the provider's name, not the raw row. */
export interface AppointmentResponse {
  id: string;
  providerId: string;
  providerName: string;
  patientName: string;
  patientEmail: string;
  scheduledAt: string;
  durationMinutes: number;
  endsAt: string;
  status: AppointmentStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The database record, joined with the bit of Provider the mapper needs. */
export interface AppointmentRecord {
  id: string;
  providerId: string;
  provider: { firstName: string; lastName: string };
  patientName: string;
  patientEmail: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Whitelisted create fields, built by the service. */
export interface CreateAppointmentData {
  providerId: string;
  patientName: string;
  patientEmail: string;
  scheduledAt: Date;
  durationMinutes: number;
  notes?: string;
}

/** Whitelisted update fields. */
export interface UpdateAppointmentData {
  patientName?: string;
  patientEmail?: string;
  scheduledAt?: Date;
  durationMinutes?: number;
  status?: AppointmentStatus;
  notes?: string;
}

/** Whitelisted filters. */
export interface AppointmentListFilters {
  search?: string;
  status?: AppointmentStatus;
  providerId?: string;
  from?: Date;
  to?: Date;
}
```

Why hand-written instead of re-exporting Prisma's types: `CreateAppointmentData` deliberately has **no `status`**. The type system now enforces the rule from question 7 — a service cannot set status through the create path even by accident.

---

## Step 4 — Repository

`src/modules/appointment/appointment.repository.ts`

```ts
import type { PrismaClientInstance, PrismaTransactionClient } from '@/database/prisma';
import { withPrismaErrors } from '@/shared/utils/prisma-error-mapper.util';
import { buildSearchFilter, omitUndefined } from '@/shared/utils/filtering.util';
import { buildOrderBy } from '@/shared/utils/sorting.util';
import type { PaginatedResult, PaginationParams, SortOrder } from '@/shared/types/list-query.type';
import type {
  AppointmentListFilters,
  AppointmentRecord,
  CreateAppointmentData,
  UpdateAppointmentData,
} from '@/modules/appointment/appointment.types';

/** Sortable fields, whitelisted. Also consumed by appointment.schema.ts. */
export const APPOINTMENT_SORT_FIELDS = [
  'scheduledAt',
  'patientName',
  'status',
  'createdAt',
] as const;

export type AppointmentSortField = (typeof APPOINTMENT_SORT_FIELDS)[number];

const APPOINTMENT_SEARCH_FIELDS = ['patientName', 'patientEmail'] as const;

export class AppointmentRepository {
  constructor(private readonly prisma: PrismaClientInstance) {}

  /** Every read joins the provider name the mapper needs — one query, no N+1. */
  private static readonly withProvider = {
    provider: { select: { firstName: true, lastName: true } },
  } as const;

  private client(tx?: PrismaTransactionClient): PrismaTransactionClient {
    return tx ?? this.prisma;
  }

  private buildWhere(filters: AppointmentListFilters) {
    // A date range becomes a single `scheduledAt` clause with optional bounds.
    // Building it here keeps the "gte/lte" shape out of the service.
    const scheduledAt =
      filters.from || filters.to
        ? omitUndefined({ gte: filters.from, lte: filters.to })
        : undefined;

    return {
      ...omitUndefined({
        status: filters.status,
        providerId: filters.providerId,
        scheduledAt,
      }),
      ...buildSearchFilter(APPOINTMENT_SEARCH_FIELDS, filters.search),
    };
  }

  async findById(id: string, tx?: PrismaTransactionClient): Promise<AppointmentRecord | null> {
    return withPrismaErrors('Appointment', () =>
      this.client(tx).appointment.findUnique({
        where: { id },
        include: AppointmentRepository.withProvider,
      }),
    );
  }

  async findMany(
    filters: AppointmentListFilters,
    pagination: PaginationParams,
    sortBy?: string,
    sortOrder: SortOrder = 'desc',
  ): Promise<PaginatedResult<AppointmentRecord>> {
    const where = this.buildWhere(filters);
    const orderBy = buildOrderBy(APPOINTMENT_SORT_FIELDS, 'scheduledAt', sortBy, sortOrder);

    return withPrismaErrors('Appointment', async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.appointment.findMany({
          where,
          include: AppointmentRepository.withProvider,
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
        }),
        this.prisma.appointment.count({ where }),
      ]);

      return { items, total };
    });
  }

  async count(filters: AppointmentListFilters = {}): Promise<number> {
    return withPrismaErrors('Appointment', () =>
      this.prisma.appointment.count({ where: this.buildWhere(filters) }),
    );
  }

  /**
   * Candidate rows for an overlap check.
   *
   * `endsAt` is not a stored column, so SQL cannot express "ends after our
   * start" directly. This returns a bounded, index-served candidate set and the
   * service finishes the comparison — see assertNoOverlap.
   */
  async findOverlapping(
    providerId: string,
    windowStart: Date,
    windowEnd: Date,
    excludeId?: string,
    tx?: PrismaTransactionClient,
  ): Promise<AppointmentRecord[]> {
    return withPrismaErrors('Appointment', () =>
      this.client(tx).appointment.findMany({
        where: {
          providerId,
          status: { not: 'CANCELLED' },
          scheduledAt: { lt: windowEnd, gte: windowStart },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        include: AppointmentRepository.withProvider,
      }),
    );
  }

  async create(
    data: CreateAppointmentData,
    tx?: PrismaTransactionClient,
  ): Promise<AppointmentRecord> {
    return withPrismaErrors('Appointment', () =>
      this.client(tx).appointment.create({
        data: {
          providerId: data.providerId,
          patientName: data.patientName,
          patientEmail: data.patientEmail,
          scheduledAt: data.scheduledAt,
          durationMinutes: data.durationMinutes,
          ...(data.notes === undefined ? {} : { notes: data.notes }),
        },
        include: AppointmentRepository.withProvider,
      }),
    );
  }

  async update(
    id: string,
    data: UpdateAppointmentData,
    tx?: PrismaTransactionClient,
  ): Promise<AppointmentRecord> {
    return withPrismaErrors('Appointment', () =>
      this.client(tx).appointment.update({
        where: { id },
        data: omitUndefined({
          patientName: data.patientName,
          patientEmail: data.patientEmail,
          scheduledAt: data.scheduledAt,
          durationMinutes: data.durationMinutes,
          status: data.status,
          notes: data.notes,
        }),
        include: AppointmentRepository.withProvider,
      }),
    );
  }

  async delete(id: string, tx?: PrismaTransactionClient): Promise<void> {
    await withPrismaErrors('Appointment', () =>
      this.client(tx).appointment.delete({ where: { id } }),
    );
  }
}
```

The four rules this file follows:

1. **Every method names its columns.** No `data: input`. A stray key has nowhere to land.
2. **Every method takes an optional `tx`.** The repository never opens a transaction; it joins one if handed a client.
3. **`findMany` + `count` in one `$transaction`.** Otherwise a concurrent insert makes the total disagree with the page.
4. **No business rules.** It does not know that past appointments are invalid.

---

## Step 5 — Validation schemas

`src/modules/appointment/appointment.schema.ts`

```ts
import { z } from 'zod';
import { AppointmentStatus } from '@/generated/prisma/enums';
import {
  emailSchema,
  paginationSchema,
  searchSchema,
  sortingSchema,
  uuidParamSchema,
} from '@/shared/validation/common.schema';
import { APPOINTMENT_SORT_FIELDS } from '@/modules/appointment/appointment.repository';

export const appointmentIdParamSchema = uuidParamSchema;

/** ISO-8601 instant. Unlike dateOfBirth, the time of day matters here. */
const isoDateTimeSchema = z.iso
  .datetime({ offset: true, message: 'must be an ISO-8601 date-time, e.g. 2026-03-01T09:00:00Z' })
  .transform((value) => new Date(value));

const patientNameSchema = z.string().trim().min(1, 'patientName is required').max(200);

const durationSchema = z
  .number()
  .int('durationMinutes must be a whole number')
  .min(5, 'appointments must be at least 5 minutes')
  .max(480, 'appointments cannot exceed 8 hours');

const notesSchema = z.string().trim().max(1000).optional();

export const listAppointmentsQuerySchema = paginationSchema
  .extend(sortingSchema(APPOINTMENT_SORT_FIELDS, 'scheduledAt').shape)
  .extend(searchSchema.shape)
  .extend({
    status: z.enum(AppointmentStatus).optional(),
    providerId: z.uuid().optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: '`from` must be before `to`',
    path: ['from'],
  });

export const createAppointmentSchema = z.object({
  providerId: z.uuid('providerId must be a valid UUID'),
  patientName: patientNameSchema,
  patientEmail: emailSchema,
  scheduledAt: isoDateTimeSchema,
  durationMinutes: durationSchema.default(30),
  notes: notesSchema,
});

/**
 * `status` is absent on purpose. Cancelling is a business action with its own
 * rules and its own endpoint, not a field a client may set to any value.
 */
export const updateAppointmentSchema = z
  .object({
    patientName: patientNameSchema.optional(),
    patientEmail: emailSchema.optional(),
    scheduledAt: isoDateTimeSchema.optional(),
    durationMinutes: durationSchema.optional(),
    notes: notesSchema,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });

export const cancelAppointmentSchema = z.object({
  reason: z.string().trim().min(1, 'a cancellation reason is required').max(500),
});

export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;
export type AppointmentIdParam = z.infer<typeof appointmentIdParamSchema>;
```

Notes:

- **Compose, don't invent.** `paginationSchema.extend(sortingSchema(…).shape).extend(searchSchema.shape)` gets pagination, whitelisted sorting and search in three lines.
- **Transform at the edge.** `isoDateTimeSchema` yields a real `Date`, so no layer below parses strings.
- **`.refine` for cross-field rules.** `from <= to` is validation, not business logic — it is about the request being coherent.
- **Never write the types by hand.** `z.infer` keeps them in lockstep.

> **Zod 4 note:** use `z.uuid()`, `z.email()`, `z.iso.datetime()` and `z.enum(NativeEnum)`. The older `z.string().uuid()`, `.email()`, `.datetime()` and `z.nativeEnum()` still work but are deprecated.

---

## Step 6 — Mapper

`src/modules/appointment/appointment.mapper.ts`

```ts
import type {
  AppointmentRecord,
  AppointmentResponse,
} from '@/modules/appointment/appointment.types';

/**
 * Entity -> DTO, field by field.
 *
 * Two things happen here that a client should not have to do itself: the joined
 * provider is flattened to a display name, and `endsAt` is derived once from
 * `scheduledAt + durationMinutes` rather than recomputed in every consumer.
 */
export function mapAppointmentToResponse(appointment: AppointmentRecord): AppointmentResponse {
  const endsAt = new Date(appointment.scheduledAt.getTime() + appointment.durationMinutes * 60_000);

  return {
    id: appointment.id,
    providerId: appointment.providerId,
    providerName: `${appointment.provider.firstName} ${appointment.provider.lastName}`,
    patientName: appointment.patientName,
    patientEmail: appointment.patientEmail,
    scheduledAt: appointment.scheduledAt.toISOString(),
    durationMinutes: appointment.durationMinutes,
    endsAt: endsAt.toISOString(),
    status: appointment.status,
    notes: appointment.notes,
    createdAt: appointment.createdAt.toISOString(),
    updatedAt: appointment.updatedAt.toISOString(),
  };
}

export function mapAppointmentsToResponse(
  appointments: AppointmentRecord[],
): AppointmentResponse[] {
  return appointments.map(mapAppointmentToResponse);
}
```

**Never `return { ...record }`.** Listing fields explicitly means the next column someone adds — an internal cost, a vendor id — does not silently appear in your public API.

---

## Step 7 — Service

`src/modules/appointment/appointment.service.ts`

```ts
import { AppointmentStatus } from '@/generated/prisma/enums';
import { BadRequestError, ConflictError, NotFoundError } from '@/errors';
import { buildPaginationMeta, getPagination } from '@/shared/utils/pagination.util';
import type { PaginationMeta } from '@/shared/response/response-envelope';
import type { ProviderRepository } from '@/modules/provider/provider.repository';
import type { AppointmentRepository } from '@/modules/appointment/appointment.repository';
import {
  mapAppointmentsToResponse,
  mapAppointmentToResponse,
} from '@/modules/appointment/appointment.mapper';
import type { AppointmentResponse } from '@/modules/appointment/appointment.types';
import type {
  CreateAppointmentInput,
  ListAppointmentsQuery,
  UpdateAppointmentInput,
} from '@/modules/appointment/appointment.schema';

export interface PaginatedAppointments {
  appointments: AppointmentResponse[];
  meta: PaginationMeta;
}

/**
 * Appointment business rules.
 *
 * Depends on two repositories — its own and Provider's. That is the sanctioned
 * way for modules to collaborate: it uses Provider's *public* repository, not
 * its internals, and there is no cycle because Provider knows nothing about
 * Appointment.
 */
export class AppointmentService {
  /** How far back an overlap search must look, given the maximum duration. */
  private static readonly MAX_DURATION_MINUTES = 480;

  constructor(
    private readonly appointmentRepository: AppointmentRepository,
    private readonly providerRepository: ProviderRepository,
  ) {}

  async listAppointments(query: ListAppointmentsQuery): Promise<PaginatedAppointments> {
    const pagination = getPagination(query);

    const { items, total } = await this.appointmentRepository.findMany(
      {
        search: query.search,
        status: query.status,
        providerId: query.providerId,
        from: query.from,
        to: query.to,
      },
      pagination,
      query.sortBy,
      query.sortOrder,
    );

    return {
      appointments: mapAppointmentsToResponse(items),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  async getAppointmentById(id: string): Promise<AppointmentResponse> {
    const appointment = await this.appointmentRepository.findById(id);
    if (!appointment) throw new NotFoundError('Appointment not found');
    return mapAppointmentToResponse(appointment);
  }

  async createAppointment(input: CreateAppointmentInput): Promise<AppointmentResponse> {
    // Rule 1: the provider must exist and be accepting appointments. Checked
    // here rather than relying on the foreign key, because "inactive" is a
    // business state the database does not know about.
    const provider = await this.providerRepository.findById(input.providerId);
    if (!provider) throw new NotFoundError('Provider not found');
    if (!provider.isActive) {
      throw new ConflictError('This provider is not currently accepting appointments');
    }

    // Rule 2: no scheduling in the past.
    if (input.scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestError('Appointments cannot be scheduled in the past');
    }

    // Rule 3: no double-booking.
    await this.assertNoOverlap(input.providerId, input.scheduledAt, input.durationMinutes);

    const appointment = await this.appointmentRepository.create({
      providerId: input.providerId,
      patientName: input.patientName,
      patientEmail: input.patientEmail,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    });

    return mapAppointmentToResponse(appointment);
  }

  async updateAppointment(id: string, input: UpdateAppointmentInput): Promise<AppointmentResponse> {
    const existing = await this.appointmentRepository.findById(id);
    if (!existing) throw new NotFoundError('Appointment not found');

    // Rule: a finished or cancelled appointment is history, not a draft.
    if (existing.status !== AppointmentStatus.SCHEDULED) {
      throw new ConflictError(
        `Cannot modify an appointment that is ${existing.status.toLowerCase()}`,
      );
    }

    const scheduledAt = input.scheduledAt ?? existing.scheduledAt;
    const durationMinutes = input.durationMinutes ?? existing.durationMinutes;

    // Re-check overlap only when the time window actually moved.
    if (input.scheduledAt || input.durationMinutes) {
      if (scheduledAt.getTime() <= Date.now()) {
        throw new BadRequestError('Appointments cannot be scheduled in the past');
      }
      await this.assertNoOverlap(existing.providerId, scheduledAt, durationMinutes, id);
    }

    const updated = await this.appointmentRepository.update(id, {
      patientName: input.patientName,
      patientEmail: input.patientEmail,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      notes: input.notes,
    });

    return mapAppointmentToResponse(updated);
  }

  /**
   * Business action, not a field update.
   *
   * Cancelling has rules (it is not allowed twice, and not after completion)
   * and a side effect worth recording. Exposing `status` on the update schema
   * instead would let a client set any status and skip all of it.
   */
  async cancelAppointment(id: string, reason: string): Promise<AppointmentResponse> {
    const existing = await this.appointmentRepository.findById(id);
    if (!existing) throw new NotFoundError('Appointment not found');

    if (existing.status === AppointmentStatus.CANCELLED) {
      throw new ConflictError('This appointment is already cancelled');
    }
    if (existing.status === AppointmentStatus.COMPLETED) {
      throw new ConflictError('A completed appointment cannot be cancelled');
    }

    const note = `Cancelled: ${reason}`;
    const cancelled = await this.appointmentRepository.update(id, {
      status: AppointmentStatus.CANCELLED,
      notes: existing.notes ? `${existing.notes}\n${note}`.slice(0, 1000) : note,
    });

    return mapAppointmentToResponse(cancelled);
  }

  async deleteAppointment(id: string): Promise<void> {
    const existing = await this.appointmentRepository.findById(id);
    if (!existing) throw new NotFoundError('Appointment not found');
    await this.appointmentRepository.delete(id);
  }

  /**
   * Throws if the requested window collides with an existing appointment.
   *
   * `endsAt` is not stored, so the query cannot express "ends after our start".
   * Instead it fetches candidates starting within one maximum-duration window
   * before our end, and the overlap test finishes in memory — a bounded,
   * indexed read rather than a scan.
   */
  private async assertNoOverlap(
    providerId: string,
    scheduledAt: Date,
    durationMinutes: number,
    excludeId?: string,
  ): Promise<void> {
    const start = scheduledAt.getTime();
    const end = start + durationMinutes * 60_000;

    const windowStart = new Date(start - AppointmentService.MAX_DURATION_MINUTES * 60_000);
    const candidates = await this.appointmentRepository.findOverlapping(
      providerId,
      windowStart,
      new Date(end),
      excludeId,
    );

    const collision = candidates.find((candidate) => {
      const candidateStart = candidate.scheduledAt.getTime();
      const candidateEnd = candidateStart + candidate.durationMinutes * 60_000;
      return candidateStart < end && candidateEnd > start;
    });

    if (collision) {
      throw new ConflictError(
        `This provider already has an appointment at ${collision.scheduledAt.toISOString()}`,
      );
    }
  }
}
```

This is where the module earns its keep. Note:

- **No Express anywhere.** No `Request`, no `Response`, no status codes — only thrown errors. That is what makes it unit-testable with two mock objects.
- **Errors carry the meaning.** `NotFoundError` → 404, `ConflictError` → 409, `BadRequestError` → 400. The service never picks a status code.
- **Cross-module access is through Provider's repository**, injected. Not `prisma.provider`, and not anything inside the provider module.
- **The business action is a method**, with its own preconditions.

---

## Step 8 — Controller

`src/modules/appointment/appointment.controller.ts`

```ts
import type { Request, Response } from 'express';
import {
  sendCreated,
  sendNoContent,
  sendPaginated,
  sendSuccess,
} from '@/shared/response/send-response.util';
import type { AppointmentService } from '@/modules/appointment/appointment.service';
import type {
  AppointmentIdParam,
  CancelAppointmentInput,
  CreateAppointmentInput,
  ListAppointmentsQuery,
  UpdateAppointmentInput,
} from '@/modules/appointment/appointment.schema';

export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  getAppointments = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListAppointmentsQuery;
    const { appointments, meta } = await this.appointmentService.listAppointments(query);
    sendPaginated(res, appointments, meta);
  };

  getAppointment = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as AppointmentIdParam;
    const appointment = await this.appointmentService.getAppointmentById(id);
    sendSuccess(res, appointment);
  };

  createAppointment = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as CreateAppointmentInput;
    const appointment = await this.appointmentService.createAppointment(input);
    sendCreated(res, appointment, 'Appointment booked successfully.');
  };

  updateAppointment = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as AppointmentIdParam;
    const input = req.body as UpdateAppointmentInput;
    const appointment = await this.appointmentService.updateAppointment(id, input);
    sendSuccess(res, appointment, 'Appointment updated successfully.');
  };

  cancelAppointment = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as AppointmentIdParam;
    const { reason } = req.body as CancelAppointmentInput;
    const appointment = await this.appointmentService.cancelAppointment(id, reason);
    sendSuccess(res, appointment, 'Appointment cancelled.');
  };

  deleteAppointment = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as AppointmentIdParam;
    await this.appointmentService.deleteAppointment(id);
    sendNoContent(res);
  };
}
```

Every method: read validated input, call one service method, send. **No `try`/`catch`** — Express 5 forwards rejections to the global error handler. **Arrow properties**, so they can be passed as route handlers without losing `this`.

If a controller method grows past ~5 lines, the logic that grew it belongs in the service.

---

## Step 9 — Routes

`src/modules/appointment/appointment.routes.ts`

```ts
import { Router, type RequestHandler } from 'express';
import { validate } from '@/middleware/validate.middleware';
import { PERMISSIONS } from '@/shared/constants/permissions.constant';
import type { AppointmentController } from '@/modules/appointment/appointment.controller';
import {
  appointmentIdParamSchema,
  cancelAppointmentSchema,
  createAppointmentSchema,
  listAppointmentsQuerySchema,
  updateAppointmentSchema,
} from '@/modules/appointment/appointment.schema';

export interface AppointmentRouteDependencies {
  controller: AppointmentController;
  authenticate: RequestHandler;
  requirePermission: (...permissions: string[]) => RequestHandler;
}

export function createAppointmentRouter({
  controller,
  authenticate,
  requirePermission,
}: AppointmentRouteDependencies): Router {
  const router = Router();

  router.use(authenticate);

  router.get(
    '/',
    requirePermission(PERMISSIONS.APPOINTMENT_VIEW),
    validate({ query: listAppointmentsQuerySchema }),
    controller.getAppointments,
  );

  router.post(
    '/',
    requirePermission(PERMISSIONS.APPOINTMENT_CREATE),
    validate({ body: createAppointmentSchema }),
    controller.createAppointment,
  );

  router.get(
    '/:id',
    requirePermission(PERMISSIONS.APPOINTMENT_VIEW),
    validate({ params: appointmentIdParamSchema }),
    controller.getAppointment,
  );

  router.patch(
    '/:id',
    requirePermission(PERMISSIONS.APPOINTMENT_EDIT),
    validate({ params: appointmentIdParamSchema, body: updateAppointmentSchema }),
    controller.updateAppointment,
  );

  // The business action gets its own sub-route and its own permission.
  // Cancelling is not the same authority as editing patient details.
  router.post(
    '/:id/cancel',
    requirePermission(PERMISSIONS.APPOINTMENT_CANCEL),
    validate({ params: appointmentIdParamSchema, body: cancelAppointmentSchema }),
    controller.cancelAppointment,
  );

  router.delete(
    '/:id',
    requirePermission(PERMISSIONS.APPOINTMENT_DELETE),
    validate({ params: appointmentIdParamSchema }),
    controller.deleteAppointment,
  );

  return router;
}
```

**Order is always** `authenticate → requirePermission → validate → controller`. Authenticate first because authorization needs to know who you are; validate after authorization so an unauthorized caller cannot probe your validation rules.

**No path prefix here.** `/api/v1/appointments` is composed once, in the next step.

> **Literal segments must precede `/:id`.** If you add `/upcoming`, declare it above `/:id` or Express matches "upcoming" as an id and the UUID check rejects it with a confusing 400. This is why `/providers/active` sits where it does.

---

## Step 10 — Wire it up

`src/routes/index.ts` — four additions:

```ts
import { AppointmentRepository } from '@/modules/appointment/appointment.repository';
import { AppointmentService } from '@/modules/appointment/appointment.service';
import { AppointmentController } from '@/modules/appointment/appointment.controller';
import { createAppointmentRouter } from '@/modules/appointment/appointment.routes';
```

Then inside `createApiRouter`:

```ts
// repositories
const appointmentRepository = new AppointmentRepository(prisma);

// services — Appointment needs Provider's repository to validate bookings
const appointmentService = new AppointmentService(appointmentRepository, providerRepository);

// controllers
const appointmentController = new AppointmentController(appointmentService);

// routing
apiRouter.use(
  '/appointments',
  createAppointmentRouter({ controller: appointmentController, authenticate, requirePermission }),
);
```

That is the whole dependency-injection story. No container, no decorators — and the compiler catches a wrong wiring.

---

## Step 11 — Document it

`src/docs/openapi.ts`. Import your schemas and add paths — the schemas you already wrote _are_ the documentation:

```ts
'/appointments': {
  get: {
    tags: ['Appointments'],
    summary: 'List appointments',
    description: 'Filter by status, provider and date range. Requires APPOINTMENT_VIEW.',
    security: bearerAuth,
    requestParams: { query: listAppointmentsQuerySchema },
    responses: {
      '200': {
        description: 'Paginated appointments',
        content: { 'application/json': { schema: paginatedOf(appointmentResponseSchema) } },
      },
      ...commonErrors,
    },
  },
  post: {
    tags: ['Appointments'],
    summary: 'Book an appointment',
    security: bearerAuth,
    requestBody: { content: { 'application/json': { schema: createAppointmentSchema } } },
    responses: {
      '201': {
        description: 'Appointment booked',
        content: { 'application/json': { schema: successOf(appointmentResponseSchema) } },
      },
      ...conflictResponse,
      ...commonErrors,
    },
  },
},
```

Add `{ name: 'Appointments', description: '…' }` to `tags`, and an `appointmentResponseSchema` next to the other response shapes.

---

## Step 12 — Test it

**Unit** — `tests/unit/appointment.service.test.ts`. Mock both repositories:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppointmentService } from '@/modules/appointment/appointment.service';
import { ConflictError, NotFoundError } from '@/errors';

function createMocks() {
  return {
    appointments: {
      findById: vi.fn(),
      findMany: vi.fn(),
      findOverlapping: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    providers: { findById: vi.fn() },
  };
}

describe('AppointmentService.createAppointment', () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: AppointmentService;

  const input = {
    providerId: '11111111-1111-4111-8111-111111111111',
    patientName: 'Jane Doe',
    patientEmail: 'jane@example.com',
    scheduledAt: new Date('2030-03-01T09:00:00Z'),
    durationMinutes: 30,
  };

  beforeEach(() => {
    mocks = createMocks();
    service = new AppointmentService(mocks.appointments as never, mocks.providers as never);
  });

  it('throws NotFoundError when the provider does not exist', async () => {
    mocks.providers.findById.mockResolvedValue(null);
    await expect(service.createAppointment(input)).rejects.toThrow(NotFoundError);
    expect(mocks.appointments.create).not.toHaveBeenCalled();
  });

  it('throws ConflictError when the provider is inactive', async () => {
    mocks.providers.findById.mockResolvedValue({ id: input.providerId, isActive: false });
    await expect(service.createAppointment(input)).rejects.toThrow(ConflictError);
  });

  it('rejects a slot that overlaps an existing appointment', async () => {
    mocks.providers.findById.mockResolvedValue({ id: input.providerId, isActive: true });
    mocks.appointments.findOverlapping.mockResolvedValue([
      { scheduledAt: new Date('2030-03-01T09:15:00Z'), durationMinutes: 30 },
    ]);

    await expect(service.createAppointment(input)).rejects.toThrow(ConflictError);
    expect(mocks.appointments.create).not.toHaveBeenCalled();
  });
});
```

**Integration** — `tests/integration/appointment.integration.test.ts`, against a real database:

```ts
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { API_BASE_PATH } from '@/config/constants';
import { ROLES } from '@/shared/constants/roles.constant';
import { getTestApp } from '../helpers/test-app';
import { disconnectDatabase, prisma, resetDatabase } from '../helpers/database';
import { authenticatedRequest } from '../helpers/auth';

const app = getTestApp();
const APPOINTMENTS = `${API_BASE_PATH}/appointments`;

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

async function seedProvider() {
  return prisma.provider.create({
    data: {
      firstName: 'Ada',
      lastName: 'Okafor',
      dateOfBirth: new Date('1981-03-14T00:00:00Z'),
      email: 'ada@example.com',
      speciality: 'Cardiology',
      isActive: true,
    },
  });
}

describe('POST /appointments', () => {
  it('books an appointment and derives endsAt', async () => {
    const provider = await seedProvider();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const response = await request(app)
      .post(APPOINTMENTS)
      .set(headers)
      .send({
        providerId: provider.id,
        patientName: 'Jane Doe',
        patientEmail: 'Jane@Example.com',
        scheduledAt: '2030-03-01T09:00:00Z',
        durationMinutes: 30,
      })
      .expect(201);

    expect(response.body.data.providerName).toBe('Ada Okafor');
    expect(response.body.data.patientEmail).toBe('jane@example.com'); // normalised
    expect(response.body.data.endsAt).toBe('2030-03-01T09:30:00.000Z');
    expect(response.body.data.status).toBe('SCHEDULED');
  });

  it('refuses to double-book a provider', async () => {
    const provider = await seedProvider();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const body = {
      providerId: provider.id,
      patientName: 'First',
      patientEmail: 'first@example.com',
      scheduledAt: '2030-03-01T09:00:00Z',
      durationMinutes: 30,
    };

    await request(app).post(APPOINTMENTS).set(headers).send(body).expect(201);

    const clash = await request(app)
      .post(APPOINTMENTS)
      .set(headers)
      .send({
        ...body,
        patientName: 'Second',
        patientEmail: 'second@example.com',
        scheduledAt: '2030-03-01T09:15:00Z',
      })
      .expect(409);

    expect(clash.body.code).toBe('CONFLICT');
  });
});

describe('POST /appointments/:id/cancel', () => {
  it('cancels once, then refuses', async () => {
    const provider = await seedProvider();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const created = await request(app)
      .post(APPOINTMENTS)
      .set(headers)
      .send({
        providerId: provider.id,
        patientName: 'Jane',
        patientEmail: 'jane@example.com',
        scheduledAt: '2030-03-01T09:00:00Z',
      })
      .expect(201);

    const id = created.body.data.id;

    const cancelled = await request(app)
      .post(`${APPOINTMENTS}/${id}/cancel`)
      .set(headers)
      .send({ reason: 'Patient rescheduled' })
      .expect(200);

    expect(cancelled.body.data.status).toBe('CANCELLED');

    await request(app)
      .post(`${APPOINTMENTS}/${id}/cancel`)
      .set(headers)
      .send({ reason: 'again' })
      .expect(409);
  });
});
```

Add `'appointments'` to the `TABLES` array in `tests/helpers/database.ts` so the reset truncates it.

---

## Step 13 — Verify

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run dev
```

Then exercise it:

```bash
API=localhost:3000/api/v1
TOKEN=…   # from /auth/login
PROVIDER=$(curl -s "$API/providers?pageSize=1&isActive=true" -H "Authorization: Bearer $TOKEN" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data[0].id))")

curl -s -X POST $API/appointments -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"providerId\":\"$PROVIDER\",\"patientName\":\"Jane Doe\",\"patientEmail\":\"jane@example.com\",\"scheduledAt\":\"2030-03-01T09:00:00Z\",\"durationMinutes\":30}"

# overlap → 409
# same call with scheduledAt 09:15 → "This provider already has an appointment at …"

curl -s "$API/appointments?status=SCHEDULED&sortBy=scheduledAt&sortOrder=asc" \
  -H "Authorization: Bearer $TOKEN"
```

`/api/docs` now lists the Appointments tag.

---

## The checklist

| File                           | Required?              | Skip it when                                           |
| ------------------------------ | ---------------------- | ------------------------------------------------------ |
| `prisma/schema.prisma` (model) | **Yes**                | —                                                      |
| `*.types.ts`                   | **Yes** in practice    | The resource has 2–3 fields and no mapper              |
| `*.schema.ts`                  | **Yes**                | Never. This is the security boundary                   |
| `*.repository.ts`              | **Yes**                | Never. Prisma must not appear above this layer         |
| `*.service.ts`                 | **Yes**                | Never — even a pass-through keeps the seam for rule #1 |
| `*.controller.ts`              | **Yes**                | —                                                      |
| `*.routes.ts`                  | **Yes**                | —                                                      |
| `*.mapper.ts`                  | When the DTO ≠ the row | Every field is public and already serialisable         |
| Permissions                    | **Yes**                | The resource is genuinely public                       |
| OpenAPI paths                  | Strongly recommended   | A private internal service                             |
| Unit test                      | When there are rules   | Pure pass-through CRUD                                 |
| Integration test               | **Yes**                | —                                                      |

Roughly 650 lines for a full module with real business rules. A plain CRUD resource with no rules lands nearer 300.

---

## Rules to not break

1. **Prisma appears only in repositories.** If you import `prisma` in a controller or service, the layering is gone.
2. **Never `data: req.body`.** Name every field. This is the mass-assignment defence.
3. **Services never import from `express`.** No `Request`, no `Response`, no status codes.
4. **Whitelist sortable fields and filters.** Never interpolate a user string into `orderBy` or `where`.
5. **Never return a Prisma record directly** when the model has, or might one day have, an internal field.
6. **Cross-module access goes through the other module's repository or service**, injected — never its internals, and never `prisma.otherModel` from your service.
7. **An action with rules is an endpoint, not a field.**

---

## See also

- [common-tasks.md](./common-tasks.md) — smaller recipes
- [decision-guides.md](./decision-guides.md) — which tool for which problem
- [architecture.md](./architecture.md) — why the layers are arranged this way
