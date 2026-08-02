import type { PrismaClientInstance, PrismaTransactionClient } from '@/database/prisma';
import { withPrismaErrors } from '@/shared/utils/prisma-error-mapper.util';
import { buildSearchFilter, omitUndefined } from '@/shared/utils/filtering.util';
import { buildOrderBy } from '@/shared/utils/sorting.util';
import type { PaginatedResult, PaginationParams, SortOrder } from '@/shared/types/list-query.type';
import type {
  CreateUserData,
  UpdateUserData,
  UserAuthContext,
  UserListFilters,
  UserWithRole,
} from '@/modules/user/user.types';

/** Fields a client may sort by. Anything else is ignored, not passed through. */
export const USER_SORT_FIELDS = ['firstName', 'lastName', 'email', 'status', 'createdAt'] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

/** Fields the search term is matched against. */
const USER_SEARCH_FIELDS = ['firstName', 'lastName', 'email'] as const;

/**
 * All user persistence. No business rules live here — the repository does not
 * decide whether an email may be reused or whether a status change is legal, it
 * only reads and writes.
 *
 * Every method takes an optional transaction client as its last argument so a
 * service can run several repositories inside one `prisma.$transaction` without
 * this class knowing anything about transaction management.
 */
export class UserRepository {
  constructor(private readonly prisma: PrismaClientInstance) {}

  /** Always include the role — every caller needs the role name. */
  private static readonly withRole = { role: { select: { id: true, name: true } } } as const;

  private client(tx?: PrismaTransactionClient): PrismaTransactionClient {
    return tx ?? this.prisma;
  }

  async findById(id: string, tx?: PrismaTransactionClient): Promise<UserWithRole | null> {
    return withPrismaErrors('User', () =>
      this.client(tx).user.findUnique({
        where: { id },
        include: UserRepository.withRole,
      }),
    );
  }

  async findByEmail(email: string, tx?: PrismaTransactionClient): Promise<UserWithRole | null> {
    return withPrismaErrors('User', () =>
      this.client(tx).user.findUnique({
        where: { email },
        include: UserRepository.withRole,
      }),
    );
  }

  /**
   * Narrow read for the authenticate middleware: runs on every authenticated
   * request, so it selects only what that middleware needs — notably not the
   * password hash.
   */
  async findAuthContextById(id: string): Promise<UserAuthContext | null> {
    return withPrismaErrors('User', () =>
      this.prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          status: true,
          role: { select: { name: true } },
        },
      }),
    );
  }

  /**
   * Paginated, filtered, sorted list.
   *
   * `findMany` and `count` run in one `$transaction` so the total cannot drift
   * from the page contents under concurrent writes.
   */
  async findMany(
    filters: UserListFilters,
    pagination: PaginationParams,
    sortBy?: string,
    sortOrder: SortOrder = 'desc',
  ): Promise<PaginatedResult<UserWithRole>> {
    const where = {
      ...omitUndefined({
        status: filters.status,
        role: filters.role ? { name: filters.role } : undefined,
      }),
      ...buildSearchFilter(USER_SEARCH_FIELDS, filters.search),
    };

    const orderBy = buildOrderBy(USER_SORT_FIELDS, 'createdAt', sortBy, sortOrder);

    return withPrismaErrors('User', async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.user.findMany({
          where,
          include: UserRepository.withRole,
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
        }),
        this.prisma.user.count({ where }),
      ]);

      return { items, total };
    });
  }

  async count(filters: UserListFilters = {}): Promise<number> {
    const where = {
      ...omitUndefined({
        status: filters.status,
        role: filters.role ? { name: filters.role } : undefined,
      }),
      ...buildSearchFilter(USER_SEARCH_FIELDS, filters.search),
    };

    return withPrismaErrors('User', () => this.prisma.user.count({ where }));
  }

  /**
   * `data` is a typed struct built by the service, never a request body. That is
   * what makes mass assignment impossible: an extra field in the JSON has
   * nowhere to go.
   */
  async create(data: CreateUserData, tx?: PrismaTransactionClient): Promise<UserWithRole> {
    return withPrismaErrors('User', () =>
      this.client(tx).user.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          passwordHash: data.passwordHash,
          roleId: data.roleId,
          ...(data.status ? { status: data.status } : {}),
        },
        include: UserRepository.withRole,
      }),
    );
  }

  async update(
    id: string,
    data: UpdateUserData,
    tx?: PrismaTransactionClient,
  ): Promise<UserWithRole> {
    return withPrismaErrors('User', () =>
      this.client(tx).user.update({
        where: { id },
        data: omitUndefined({
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          status: data.status,
          roleId: data.roleId,
          passwordHash: data.passwordHash,
        }),
        include: UserRepository.withRole,
      }),
    );
  }

  async delete(id: string, tx?: PrismaTransactionClient): Promise<void> {
    await withPrismaErrors('User', () => this.client(tx).user.delete({ where: { id } }));
  }

  async findRoleIdByName(name: string, tx?: PrismaTransactionClient): Promise<string | null> {
    const role = await withPrismaErrors('Role', () =>
      this.client(tx).role.findUnique({ where: { name }, select: { id: true } }),
    );
    return role?.id ?? null;
  }
}
