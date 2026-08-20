# Adding a module

A complete worked example: a **Task** module — a scheduled unit of work assigned to a user.

The domain is deliberately dull. This template ships none, and the point here is the
*shape* of a module, not the subject. Substitute your own nouns as you read.

Task earns its place because it needs everything the shipped `user` module does not
demonstrate: a **foreign key** to another module, an **enum filter**, a **date-range
filter**, real **business rules**, and a **non-CRUD action** (cancel). It references
`User`, which does exist here, so you can build it as you read rather than inventing a
second model first.

Every file below follows the same layering as `src/modules/user/`. If something here
disagrees with that module, the module is right — it is the one under test.

---

## Step 0 — Answer these first

Deciding before writing is what keeps a module small.

| #   | Question                               | For Task                                                       |
| --- | -------------------------------------- | --------------------------------------------------------------------- |
| 1   | Is this standard CRUD?                 | Mostly — plus one business action                                     |
| 2   | Does it reference another module?      | Yes, `User` — use its **repository**, never its internals         |
| 3   | What can a client filter by?           | `status`, `assigneeId`, a date range, free-text search                |
| 4   | What can a client sort by?             | `startsAt`, `title`, `status`, `createdAt`                   |
| 5   | Does the response differ from the row? | Yes — flatten the assignee name, derive `endsAt` → **needs a mapper** |
| 6   | Are there non-CRUD actions?            | Cancel — its own endpoint and its own permission                      |
| 7   | Any field a client must **not** set?   | `status`. Cancelling has rules; a PATCH would skip them               |
| 8   | Hard or soft delete?                   | Hard — `status: CANCELLED` is the real "undo"                         |
| 9   | Which permissions?                     | `TASK_VIEW/CREATE/EDIT/CANCEL/DELETE`                          |
| 10  | Does anything need a transaction?      | No — every operation is a single write                                |

Question 7 is the one people skip. **If an action has rules, it is not a field.**

---

## Step 1 — Schema

`prisma/schema.prisma` — add the enum and model, and the back-relation on `User`:

```prisma
enum TaskStatus {
  SCHEDULED
  COMPLETED
  CANCELLED
}

model Task {
  id String @id @default(uuid()) @db.Uuid

  assigneeId String   @db.Uuid
  assignee   User @relation(fields: [assigneeId], references: [id], onDelete: Restrict)

  title  String @db.VarChar(200)
  requesterEmail String @db.VarChar(255)

  startsAt     DateTime
  durationMinutes Int               @default(30)
  status          TaskStatus @default(SCHEDULED)
  notes           String?           @db.VarChar(1000)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([assigneeId, startsAt]) // "this assignee's workload" — the main query
  @@index([status])
  @@index([startsAt])
  @@map("tasks")
}
```

And inside `model User`:

```prisma
  tasks Task[]
```

Three decisions worth stating:

- **`onDelete: Restrict`** — deleting an assignee who has tasks should fail loudly, not silently destroy history. Prisma raises `P2003`, which the error mapper turns into a 400.
- **`@@index([assigneeId, startsAt])`** is composite because the dominant query filters by assignee _and_ orders by time. Two separate indexes would not serve it as well.
- **No `endsAt` column.** It is `startsAt + durationMinutes`; storing it invites the two disagreeing.

```bash
npm run prisma:migrate    # name it: add_tasks
```

`prisma generate` runs automatically, so `TaskStatus` is importable immediately.

---

## Step 2 — Permissions

`src/shared/constants/permissions.constant.ts`:

```ts
export const PERMISSIONS = {
  // …
  TASK_VIEW: 'TASK_VIEW',
  TASK_CREATE: 'TASK_CREATE',
  TASK_EDIT: 'TASK_EDIT',
  // Cancelling is separate from editing on purpose: a coordinator may often
  // cancel without being allowed to rewrite requester details.
  TASK_CANCEL: 'TASK_CANCEL',
  TASK_DELETE: 'TASK_DELETE',
} as const;
```

Add descriptions to `PERMISSION_DESCRIPTIONS` (the type makes this mandatory — a missing key is a compile error), then grant them:

```ts
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, PermissionKey[]> = {
  [ROLES.SUPER_ADMIN]: ALL_PERMISSIONS,
  [ROLES.ADMIN]: [
    // …
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_CREATE,
    PERMISSIONS.TASK_EDIT,
    PERMISSIONS.TASK_CANCEL,
    PERMISSIONS.TASK_DELETE,
  ],
  [ROLES.USER]: [
    PERMISSIONS.USER_VIEW,
    PERMISSIONS.TASK_VIEW,
    PERMISSIONS.TASK_CREATE,
  ],
};
```

```bash
npm run prisma:seed   # idempotent: adds new grants, never removes existing ones
```

---

## Step 3 — Types

`src/modules/task/task.types.ts`

```ts
import type { TaskStatus } from '@/generated/prisma/enums';

/** What the API returns. Note it exposes the assignee's name, not the raw row. */
export interface TaskResponse {
  id: string;
  assigneeId: string;
  assigneeName: string;
  title: string;
  requesterEmail: string;
  startsAt: string;
  durationMinutes: number;
  endsAt: string;
  status: TaskStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The database record, joined with the bit of User the mapper needs. */
export interface TaskRecord {
  id: string;
  assigneeId: string;
  assignee: { firstName: string; lastName: string };
  title: string;
  requesterEmail: string;
  startsAt: Date;
  durationMinutes: number;
  status: TaskStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Whitelisted create fields, built by the service. */
export interface CreateTaskData {
  assigneeId: string;
  title: string;
  requesterEmail: string;
  startsAt: Date;
  durationMinutes: number;
  notes?: string;
}

/** Whitelisted update fields. */
export interface UpdateTaskData {
  title?: string;
  requesterEmail?: string;
  startsAt?: Date;
  durationMinutes?: number;
  status?: TaskStatus;
  notes?: string;
}

/** Whitelisted filters. */
export interface TaskListFilters {
  search?: string;
  status?: TaskStatus;
  assigneeId?: string;
  from?: Date;
  to?: Date;
}
```

Why hand-written instead of re-exporting Prisma's types: `CreateTaskData` deliberately has **no `status`**. The type system now enforces the rule from question 7 — a service cannot set status through the create path even by accident.

---

## Step 4 — Repository

`src/modules/task/task.repository.ts`

```ts
import type { PrismaClientInstance, PrismaTransactionClient } from '@/database/prisma';
import { withPrismaErrors } from '@/shared/utils/prisma-error-mapper.util';
import { buildSearchFilter, omitUndefined } from '@/shared/utils/filtering.util';
import { buildOrderBy } from '@/shared/utils/sorting.util';
import type { PaginatedResult, PaginationParams, SortOrder } from '@/shared/types/list-query.type';
import type {
  TaskListFilters,
  TaskRecord,
  CreateTaskData,
  UpdateTaskData,
} from '@/modules/task/task.types';

/** Sortable fields, whitelisted. Also consumed by task.schema.ts. */
export const TASK_SORT_FIELDS = [
  'startsAt',
  'title',
  'status',
  'createdAt',
] as const;

export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];

const TASK_SEARCH_FIELDS = ['title', 'requesterEmail'] as const;

export class TaskRepository {
  constructor(private readonly prisma: PrismaClientInstance) {}

  /** Every read joins the assignee name the mapper needs — one query, no N+1. */
  private static readonly withUser = {
    assignee: { select: { firstName: true, lastName: true } },
  } as const;

  private client(tx?: PrismaTransactionClient): PrismaTransactionClient {
    return tx ?? this.prisma;
  }

  private buildWhere(filters: TaskListFilters) {
    // A date range becomes a single `startsAt` clause with optional bounds.
    // Building it here keeps the "gte/lte" shape out of the service.
    const startsAt =
      filters.from || filters.to
        ? omitUndefined({ gte: filters.from, lte: filters.to })
        : undefined;

    return {
      ...omitUndefined({
        status: filters.status,
        assigneeId: filters.assigneeId,
        startsAt,
      }),
      ...buildSearchFilter(TASK_SEARCH_FIELDS, filters.search),
    };
  }

  async findById(id: string, tx?: PrismaTransactionClient): Promise<TaskRecord | null> {
    return withPrismaErrors('Task', () =>
      this.client(tx).task.findUnique({
        where: { id },
        include: TaskRepository.withUser,
      }),
    );
  }

  async findMany(
    filters: TaskListFilters,
    pagination: PaginationParams,
    sortBy?: string,
    sortOrder: SortOrder = 'desc',
  ): Promise<PaginatedResult<TaskRecord>> {
    const where = this.buildWhere(filters);
    const orderBy = buildOrderBy(TASK_SORT_FIELDS, 'startsAt', sortBy, sortOrder);

    return withPrismaErrors('Task', async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.task.findMany({
          where,
          include: TaskRepository.withUser,
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
        }),
        this.prisma.task.count({ where }),
      ]);

      return { items, total };
    });
  }

  async count(filters: TaskListFilters = {}): Promise<number> {
    return withPrismaErrors('Task', () =>
      this.prisma.task.count({ where: this.buildWhere(filters) }),
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
    assigneeId: string,
    windowStart: Date,
    windowEnd: Date,
    excludeId?: string,
    tx?: PrismaTransactionClient,
  ): Promise<TaskRecord[]> {
    return withPrismaErrors('Task', () =>
      this.client(tx).task.findMany({
        where: {
          assigneeId,
          status: { not: 'CANCELLED' },
          startsAt: { lt: windowEnd, gte: windowStart },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        include: TaskRepository.withUser,
      }),
    );
  }

  async create(
    data: CreateTaskData,
    tx?: PrismaTransactionClient,
  ): Promise<TaskRecord> {
    return withPrismaErrors('Task', () =>
      this.client(tx).task.create({
        data: {
          assigneeId: data.assigneeId,
          title: data.title,
          requesterEmail: data.requesterEmail,
          startsAt: data.startsAt,
          durationMinutes: data.durationMinutes,
          ...(data.notes === undefined ? {} : { notes: data.notes }),
        },
        include: TaskRepository.withUser,
      }),
    );
  }

  async update(
    id: string,
    data: UpdateTaskData,
    tx?: PrismaTransactionClient,
  ): Promise<TaskRecord> {
    return withPrismaErrors('Task', () =>
      this.client(tx).task.update({
        where: { id },
        data: omitUndefined({
          title: data.title,
          requesterEmail: data.requesterEmail,
          startsAt: data.startsAt,
          durationMinutes: data.durationMinutes,
          status: data.status,
          notes: data.notes,
        }),
        include: TaskRepository.withUser,
      }),
    );
  }

  async delete(id: string, tx?: PrismaTransactionClient): Promise<void> {
    await withPrismaErrors('Task', () =>
      this.client(tx).task.delete({ where: { id } }),
    );
  }
}
```

The four rules this file follows:

1. **Every method names its columns.** No `data: input`. A stray key has nowhere to land.
2. **Every method takes an optional `tx`.** The repository never opens a transaction; it joins one if handed a client.
3. **`findMany` + `count` in one `$transaction`.** Otherwise a concurrent insert makes the total disagree with the page.
4. **No business rules.** It does not know that past tasks are invalid.

---

## Step 5 — Validation schemas

`src/modules/task/task.schema.ts`

```ts
import { z } from 'zod';
import { TaskStatus } from '@/generated/prisma/enums';
import {
  emailSchema,
  paginationSchema,
  searchSchema,
  sortingSchema,
  uuidParamSchema,
} from '@/shared/validation/common.schema';
import { TASK_SORT_FIELDS } from '@/modules/task/task.repository';

export const taskIdParamSchema = uuidParamSchema;

/** ISO-8601 instant. Unlike dateOfBirth, the time of day matters here. */
const isoDateTimeSchema = z.iso
  .datetime({ offset: true, message: 'must be an ISO-8601 date-time, e.g. 2026-03-01T09:00:00Z' })
  .transform((value) => new Date(value));

const titleSchema = z.string().trim().min(1, 'title is required').max(200);

const durationSchema = z
  .number()
  .int('durationMinutes must be a whole number')
  .min(5, 'tasks must be at least 5 minutes')
  .max(480, 'tasks cannot exceed 8 hours');

const notesSchema = z.string().trim().max(1000).optional();

export const listTasksQuerySchema = paginationSchema
  .extend(sortingSchema(TASK_SORT_FIELDS, 'startsAt').shape)
  .extend(searchSchema.shape)
  .extend({
    status: z.enum(TaskStatus).optional(),
    assigneeId: z.uuid().optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: '`from` must be before `to`',
    path: ['from'],
  });

export const createTaskSchema = z.object({
  assigneeId: z.uuid('assigneeId must be a valid UUID'),
  title: titleSchema,
  requesterEmail: emailSchema,
  startsAt: isoDateTimeSchema,
  durationMinutes: durationSchema.default(30),
  notes: notesSchema,
});

/**
 * `status` is absent on purpose. Cancelling is a business action with its own
 * rules and its own endpoint, not a field a client may set to any value.
 */
export const updateTaskSchema = z
  .object({
    title: titleSchema.optional(),
    requesterEmail: emailSchema.optional(),
    startsAt: isoDateTimeSchema.optional(),
    durationMinutes: durationSchema.optional(),
    notes: notesSchema,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });

export const cancelTaskSchema = z.object({
  reason: z.string().trim().min(1, 'a cancellation reason is required').max(500),
});

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CancelTaskInput = z.infer<typeof cancelTaskSchema>;
export type TaskIdParam = z.infer<typeof taskIdParamSchema>;
```

Notes:

- **Compose, don't invent.** `paginationSchema.extend(sortingSchema(…).shape).extend(searchSchema.shape)` gets pagination, whitelisted sorting and search in three lines.
- **Transform at the edge.** `isoDateTimeSchema` yields a real `Date`, so no layer below parses strings.
- **`.refine` for cross-field rules.** `from <= to` is validation, not business logic — it is about the request being coherent.
- **Never write the types by hand.** `z.infer` keeps them in lockstep.

> **Zod 4 note:** use `z.uuid()`, `z.email()`, `z.iso.datetime()` and `z.enum(NativeEnum)`. The older `z.string().uuid()`, `.email()`, `.datetime()` and `z.nativeEnum()` still work but are deprecated.

---

## Step 6 — Mapper

`src/modules/task/task.mapper.ts`

```ts
import type {
  TaskRecord,
  TaskResponse,
} from '@/modules/task/task.types';

/**
 * Entity -> DTO, field by field.
 *
 * Two things happen here that a client should not have to do itself: the joined
 * assignee is flattened to a display name, and `endsAt` is derived once from
 * `startsAt + durationMinutes` rather than recomputed in every consumer.
 */
export function mapTaskToResponse(task: TaskRecord): TaskResponse {
  const endsAt = new Date(task.startsAt.getTime() + task.durationMinutes * 60_000);

  return {
    id: task.id,
    assigneeId: task.assigneeId,
    assigneeName: `${task.assignee.firstName} ${task.assignee.lastName}`,
    title: task.title,
    requesterEmail: task.requesterEmail,
    startsAt: task.startsAt.toISOString(),
    durationMinutes: task.durationMinutes,
    endsAt: endsAt.toISOString(),
    status: task.status,
    notes: task.notes,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function mapTasksToResponse(
  tasks: TaskRecord[],
): TaskResponse[] {
  return tasks.map(mapTaskToResponse);
}
```

**Never `return { ...record }`.** Listing fields explicitly means the next column someone adds — an internal cost, a vendor id — does not silently appear in your public API.

---

## Step 7 — Service

`src/modules/task/task.service.ts`

```ts
import { TaskStatus } from '@/generated/prisma/enums';
import { BadRequestError, ConflictError, NotFoundError } from '@/errors';
import { buildPaginationMeta, getPagination } from '@/shared/utils/pagination.util';
import type { PaginationMeta } from '@/shared/response/response-envelope';
import type { UserRepository } from '@/modules/assignee/assignee.repository';
import type { TaskRepository } from '@/modules/task/task.repository';
import {
  mapTasksToResponse,
  mapTaskToResponse,
} from '@/modules/task/task.mapper';
import type { TaskResponse } from '@/modules/task/task.types';
import type {
  CreateTaskInput,
  ListTasksQuery,
  UpdateTaskInput,
} from '@/modules/task/task.schema';

export interface PaginatedTasks {
  tasks: TaskResponse[];
  meta: PaginationMeta;
}

/**
 * Task business rules.
 *
 * Depends on two repositories — its own and User's. That is the sanctioned
 * way for modules to collaborate: it uses User's *public* repository, not
 * its internals, and there is no cycle because User knows nothing about
 * Task.
 */
export class TaskService {
  /** How far back an overlap search must look, given the maximum duration. */
  private static readonly MAX_DURATION_MINUTES = 480;

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async listTasks(query: ListTasksQuery): Promise<PaginatedTasks> {
    const pagination = getPagination(query);

    const { items, total } = await this.taskRepository.findMany(
      {
        search: query.search,
        status: query.status,
        assigneeId: query.assigneeId,
        from: query.from,
        to: query.to,
      },
      pagination,
      query.sortBy,
      query.sortOrder,
    );

    return {
      tasks: mapTasksToResponse(items),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  async getTaskById(id: string): Promise<TaskResponse> {
    const task = await this.taskRepository.findById(id);
    if (!task) throw new NotFoundError('Task not found');
    return mapTaskToResponse(task);
  }

  async createTask(input: CreateTaskInput): Promise<TaskResponse> {
    // Rule 1: the assignee must exist and be accepting tasks. Checked
    // here rather than relying on the foreign key, because "inactive" is a
    // business state the database does not know about.
    const assignee = await this.userRepository.findById(input.assigneeId);
    if (!assignee) throw new NotFoundError('User not found');
    if (!assignee.isActive) {
      throw new ConflictError('This assignee is not currently accepting tasks');
    }

    // Rule 2: no scheduling in the past.
    if (input.startsAt.getTime() <= Date.now()) {
      throw new BadRequestError('Tasks cannot be scheduled in the past');
    }

    // Rule 3: no double-booking.
    await this.assertNoOverlap(input.assigneeId, input.startsAt, input.durationMinutes);

    const task = await this.taskRepository.create({
      assigneeId: input.assigneeId,
      title: input.title,
      requesterEmail: input.requesterEmail,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    });

    return mapTaskToResponse(task);
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<TaskResponse> {
    const existing = await this.taskRepository.findById(id);
    if (!existing) throw new NotFoundError('Task not found');

    // Rule: a finished or cancelled task is history, not a draft.
    if (existing.status !== TaskStatus.SCHEDULED) {
      throw new ConflictError(
        `Cannot modify a task that is ${existing.status.toLowerCase()}`,
      );
    }

    const startsAt = input.startsAt ?? existing.startsAt;
    const durationMinutes = input.durationMinutes ?? existing.durationMinutes;

    // Re-check overlap only when the time window actually moved.
    if (input.startsAt || input.durationMinutes) {
      if (startsAt.getTime() <= Date.now()) {
        throw new BadRequestError('Tasks cannot be scheduled in the past');
      }
      await this.assertNoOverlap(existing.assigneeId, startsAt, durationMinutes, id);
    }

    const updated = await this.taskRepository.update(id, {
      title: input.title,
      requesterEmail: input.requesterEmail,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      notes: input.notes,
    });

    return mapTaskToResponse(updated);
  }

  /**
   * Business action, not a field update.
   *
   * Cancelling has rules (it is not allowed twice, and not after completion)
   * and a side effect worth recording. Exposing `status` on the update schema
   * instead would let a client set any status and skip all of it.
   */
  async cancelTask(id: string, reason: string): Promise<TaskResponse> {
    const existing = await this.taskRepository.findById(id);
    if (!existing) throw new NotFoundError('Task not found');

    if (existing.status === TaskStatus.CANCELLED) {
      throw new ConflictError('This task is already cancelled');
    }
    if (existing.status === TaskStatus.COMPLETED) {
      throw new ConflictError('A completed task cannot be cancelled');
    }

    const note = `Cancelled: ${reason}`;
    const cancelled = await this.taskRepository.update(id, {
      status: TaskStatus.CANCELLED,
      notes: existing.notes ? `${existing.notes}\n${note}`.slice(0, 1000) : note,
    });

    return mapTaskToResponse(cancelled);
  }

  async deleteTask(id: string): Promise<void> {
    const existing = await this.taskRepository.findById(id);
    if (!existing) throw new NotFoundError('Task not found');
    await this.taskRepository.delete(id);
  }

  /**
   * Throws if the requested window collides with an existing task.
   *
   * `endsAt` is not stored, so the query cannot express "ends after our start".
   * Instead it fetches candidates starting within one maximum-duration window
   * before our end, and the overlap test finishes in memory — a bounded,
   * indexed read rather than a scan.
   */
  private async assertNoOverlap(
    assigneeId: string,
    startsAt: Date,
    durationMinutes: number,
    excludeId?: string,
  ): Promise<void> {
    const start = startsAt.getTime();
    const end = start + durationMinutes * 60_000;

    const windowStart = new Date(start - TaskService.MAX_DURATION_MINUTES * 60_000);
    const candidates = await this.taskRepository.findOverlapping(
      assigneeId,
      windowStart,
      new Date(end),
      excludeId,
    );

    const collision = candidates.find((candidate) => {
      const candidateStart = candidate.startsAt.getTime();
      const candidateEnd = candidateStart + candidate.durationMinutes * 60_000;
      return candidateStart < end && candidateEnd > start;
    });

    if (collision) {
      throw new ConflictError(
        `This assignee already has a task at ${collision.startsAt.toISOString()}`,
      );
    }
  }
}
```

This is where the module earns its keep. Note:

- **No Express anywhere.** No `Request`, no `Response`, no status codes — only thrown errors. That is what makes it unit-testable with two mock objects.
- **Errors carry the meaning.** `NotFoundError` → 404, `ConflictError` → 409, `BadRequestError` → 400. The service never picks a status code.
- **Cross-module access is through User's repository**, injected. Not `prisma.assignee`, and not anything inside the assignee module.
- **The business action is a method**, with its own preconditions.

---

## Step 8 — Controller

`src/modules/task/task.controller.ts`

```ts
import type { Request, Response } from 'express';
import {
  sendCreated,
  sendNoContent,
  sendPaginated,
  sendSuccess,
} from '@/shared/response/send-response.util';
import type { TaskService } from '@/modules/task/task.service';
import type {
  TaskIdParam,
  CancelTaskInput,
  CreateTaskInput,
  ListTasksQuery,
  UpdateTaskInput,
} from '@/modules/task/task.schema';

export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  getTasks = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListTasksQuery;
    const { tasks, meta } = await this.taskService.listTasks(query);
    sendPaginated(res, tasks, meta);
  };

  getTask = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as TaskIdParam;
    const task = await this.taskService.getTaskById(id);
    sendSuccess(res, task);
  };

  createTask = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as CreateTaskInput;
    const task = await this.taskService.createTask(input);
    sendCreated(res, task, 'Task booked successfully.');
  };

  updateTask = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as TaskIdParam;
    const input = req.body as UpdateTaskInput;
    const task = await this.taskService.updateTask(id, input);
    sendSuccess(res, task, 'Task updated successfully.');
  };

  cancelTask = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as TaskIdParam;
    const { reason } = req.body as CancelTaskInput;
    const task = await this.taskService.cancelTask(id, reason);
    sendSuccess(res, task, 'Task cancelled.');
  };

  deleteTask = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as TaskIdParam;
    await this.taskService.deleteTask(id);
    sendNoContent(res);
  };
}
```

Every method: read validated input, call one service method, send. **No `try`/`catch`** — Express 5 forwards rejections to the global error handler. **Arrow properties**, so they can be passed as route handlers without losing `this`.

If a controller method grows past ~5 lines, the logic that grew it belongs in the service.

---

## Step 9 — Routes

`src/modules/task/task.routes.ts`

```ts
import { Router, type RequestHandler } from 'express';
import { validate } from '@/middleware/validate.middleware';
import { PERMISSIONS } from '@/shared/constants/permissions.constant';
import type { TaskController } from '@/modules/task/task.controller';
import {
  taskIdParamSchema,
  cancelTaskSchema,
  createTaskSchema,
  listTasksQuerySchema,
  updateTaskSchema,
} from '@/modules/task/task.schema';

export interface TaskRouteDependencies {
  controller: TaskController;
  authenticate: RequestHandler;
  requirePermission: (...permissions: string[]) => RequestHandler;
}

export function createTaskRouter({
  controller,
  authenticate,
  requirePermission,
}: TaskRouteDependencies): Router {
  const router = Router();

  router.use(authenticate);

  router.get(
    '/',
    requirePermission(PERMISSIONS.TASK_VIEW),
    validate({ query: listTasksQuerySchema }),
    controller.getTasks,
  );

  router.post(
    '/',
    requirePermission(PERMISSIONS.TASK_CREATE),
    validate({ body: createTaskSchema }),
    controller.createTask,
  );

  router.get(
    '/:id',
    requirePermission(PERMISSIONS.TASK_VIEW),
    validate({ params: taskIdParamSchema }),
    controller.getTask,
  );

  router.patch(
    '/:id',
    requirePermission(PERMISSIONS.TASK_EDIT),
    validate({ params: taskIdParamSchema, body: updateTaskSchema }),
    controller.updateTask,
  );

  // The business action gets its own sub-route and its own permission.
  // Cancelling is not the same authority as editing requester details.
  router.post(
    '/:id/cancel',
    requirePermission(PERMISSIONS.TASK_CANCEL),
    validate({ params: taskIdParamSchema, body: cancelTaskSchema }),
    controller.cancelTask,
  );

  router.delete(
    '/:id',
    requirePermission(PERMISSIONS.TASK_DELETE),
    validate({ params: taskIdParamSchema }),
    controller.deleteTask,
  );

  return router;
}
```

**Order is always** `authenticate → requirePermission → validate → controller`. Authenticate first because authorization needs to know who you are; validate after authorization so an unauthorized caller cannot probe your validation rules.

**No path prefix here.** `/api/v1/tasks` is composed once, in the next step.

> **Literal segments must precede `/:id`.** If you add `/upcoming`, declare it above `/:id` or Express matches "upcoming" as an id and the UUID check rejects it with a confusing 400. This is why `/users/active` sits where it does.

---

## Step 10 — Wire it up

`src/routes/index.ts` — four additions:

```ts
import { TaskRepository } from '@/modules/task/task.repository';
import { TaskService } from '@/modules/task/task.service';
import { TaskController } from '@/modules/task/task.controller';
import { createTaskRouter } from '@/modules/task/task.routes';
```

Then inside `createApiRouter`:

```ts
// repositories
const taskRepository = new TaskRepository(prisma);

// services — Task needs User's repository to validate bookings
const taskService = new TaskService(taskRepository, userRepository);

// controllers
const taskController = new TaskController(taskService);

// routing
apiRouter.use(
  '/tasks',
  createTaskRouter({ controller: taskController, authenticate, requirePermission }),
);
```

That is the whole dependency-injection story. No container, no decorators — and the compiler catches a wrong wiring.

---

## Step 11 — Document it

`src/docs/openapi.ts`. Import your schemas and add paths — the schemas you already wrote _are_ the documentation:

```ts
'/tasks': {
  get: {
    tags: ['Tasks'],
    summary: 'List tasks',
    description: 'Filter by status, assignee and date range. Requires TASK_VIEW.',
    security: bearerAuth,
    requestParams: { query: listTasksQuerySchema },
    responses: {
      '200': {
        description: 'Paginated tasks',
        content: { 'application/json': { schema: paginatedOf(taskResponseSchema) } },
      },
      ...commonErrors,
    },
  },
  post: {
    tags: ['Tasks'],
    summary: 'Book a task',
    security: bearerAuth,
    requestBody: { content: { 'application/json': { schema: createTaskSchema } } },
    responses: {
      '201': {
        description: 'Task booked',
        content: { 'application/json': { schema: successOf(taskResponseSchema) } },
      },
      ...conflictResponse,
      ...commonErrors,
    },
  },
},
```

Add `{ name: 'Tasks', description: '…' }` to `tags`, and an `taskResponseSchema` next to the other response shapes.

---

## Step 12 — Test it

**Unit** — `tests/unit/task.service.test.ts`. Mock both repositories:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskService } from '@/modules/task/task.service';
import { ConflictError, NotFoundError } from '@/errors';

function createMocks() {
  return {
    tasks: {
      findById: vi.fn(),
      findMany: vi.fn(),
      findOverlapping: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    users: { findById: vi.fn() },
  };
}

describe('TaskService.createTask', () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: TaskService;

  const input = {
    assigneeId: '11111111-1111-4111-8111-111111111111',
    title: 'Jane Doe',
    requesterEmail: 'jane@example.com',
    startsAt: new Date('2030-03-01T09:00:00Z'),
    durationMinutes: 30,
  };

  beforeEach(() => {
    mocks = createMocks();
    service = new TaskService(mocks.tasks as never, mocks.users as never);
  });

  it('throws NotFoundError when the assignee does not exist', async () => {
    mocks.users.findById.mockResolvedValue(null);
    await expect(service.createTask(input)).rejects.toThrow(NotFoundError);
    expect(mocks.tasks.create).not.toHaveBeenCalled();
  });

  it('throws ConflictError when the assignee is inactive', async () => {
    mocks.users.findById.mockResolvedValue({ id: input.assigneeId, isActive: false });
    await expect(service.createTask(input)).rejects.toThrow(ConflictError);
  });

  it('rejects a slot that overlaps an existing task', async () => {
    mocks.users.findById.mockResolvedValue({ id: input.assigneeId, isActive: true });
    mocks.tasks.findOverlapping.mockResolvedValue([
      { startsAt: new Date('2030-03-01T09:15:00Z'), durationMinutes: 30 },
    ]);

    await expect(service.createTask(input)).rejects.toThrow(ConflictError);
    expect(mocks.tasks.create).not.toHaveBeenCalled();
  });
});
```

**Integration** — `tests/integration/task.integration.test.ts`, against a real database:

```ts
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { API_BASE_PATH } from '@/config/constants';
import { ROLES } from '@/shared/constants/roles.constant';
import { getTestApp } from '../helpers/test-app';
import { disconnectDatabase, prisma, resetDatabase } from '../helpers/database';
import { authenticatedRequest } from '../helpers/auth';

const app = getTestApp();
const TASKS = `${API_BASE_PATH}/tasks`;

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

async function seedAssignee() {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'USER' } });

  return prisma.user.create({
    data: {
      firstName: 'Ada',
      lastName: 'Okafor',
      email: 'ada@example.com',
      passwordHash: await hashPassword('SeedPassword123'),
      roleId: role.id,
    },
  });
}

describe('POST /tasks', () => {
  it('books a task and derives endsAt', async () => {
    const assignee = await seedAssignee();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const response = await request(app)
      .post(TASKS)
      .set(headers)
      .send({
        assigneeId: assignee.id,
        title: 'Jane Doe',
        requesterEmail: 'Jane@Example.com',
        startsAt: '2030-03-01T09:00:00Z',
        durationMinutes: 30,
      })
      .expect(201);

    expect(response.body.data.assigneeName).toBe('Ada Okafor');
    expect(response.body.data.requesterEmail).toBe('jane@example.com'); // normalised
    expect(response.body.data.endsAt).toBe('2030-03-01T09:30:00.000Z');
    expect(response.body.data.status).toBe('SCHEDULED');
  });

  it('refuses to double-book an assignee', async () => {
    const assignee = await seedAssignee();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const body = {
      assigneeId: assignee.id,
      title: 'First',
      requesterEmail: 'first@example.com',
      startsAt: '2030-03-01T09:00:00Z',
      durationMinutes: 30,
    };

    await request(app).post(TASKS).set(headers).send(body).expect(201);

    const clash = await request(app)
      .post(TASKS)
      .set(headers)
      .send({
        ...body,
        title: 'Second',
        requesterEmail: 'second@example.com',
        startsAt: '2030-03-01T09:15:00Z',
      })
      .expect(409);

    expect(clash.body.code).toBe('CONFLICT');
  });
});

describe('POST /tasks/:id/cancel', () => {
  it('cancels once, then refuses', async () => {
    const assignee = await seedAssignee();
    const { headers } = await authenticatedRequest({ role: ROLES.ADMIN });

    const created = await request(app)
      .post(TASKS)
      .set(headers)
      .send({
        assigneeId: assignee.id,
        title: 'Jane',
        requesterEmail: 'jane@example.com',
        startsAt: '2030-03-01T09:00:00Z',
      })
      .expect(201);

    const id = created.body.data.id;

    const cancelled = await request(app)
      .post(`${TASKS}/${id}/cancel`)
      .set(headers)
      .send({ reason: 'Requester rescheduled' })
      .expect(200);

    expect(cancelled.body.data.status).toBe('CANCELLED');

    await request(app)
      .post(`${TASKS}/${id}/cancel`)
      .set(headers)
      .send({ reason: 'again' })
      .expect(409);
  });
});
```

Add `'tasks'` to the `TABLES` array in `tests/helpers/database.ts` so the reset truncates it.

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
API=localhost:4000/api/v1
TOKEN=…   # from /auth/login
ASSIGNEE=$(curl -s "$API/users?pageSize=1&status=ACTIVE" -H "Authorization: Bearer $TOKEN" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data[0].id))")

curl -s -X POST $API/tasks -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"assigneeId\":\"$ASSIGNEE\",\"title\":\"Renew the TLS certificate\",\"requesterEmail\":\"jane@example.com\",\"startsAt\":\"2030-03-01T09:00:00Z\",\"durationMinutes\":30}"

# overlap → 409
# same call with startsAt 09:15 → "This assignee already has a task at …"

curl -s "$API/tasks?status=SCHEDULED&sortBy=startsAt&sortOrder=asc" \
  -H "Authorization: Bearer $TOKEN"
```

`/api/docs` now lists the Tasks tag.

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
