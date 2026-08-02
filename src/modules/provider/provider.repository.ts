import type { PrismaClientInstance, PrismaTransactionClient } from '@/database/prisma';
import { withPrismaErrors } from '@/shared/utils/prisma-error-mapper.util';
import { buildSearchFilter, omitUndefined } from '@/shared/utils/filtering.util';
import { buildOrderBy } from '@/shared/utils/sorting.util';
import type { PaginatedResult, PaginationParams, SortOrder } from '@/shared/types/list-query.type';
import type {
  CreateProviderData,
  ProviderListFilters,
  ProviderRecord,
  UpdateProviderData,
} from '@/modules/provider/provider.types';

/**
 * Sortable fields, whitelisted.
 *
 * A raw `orderBy: { [req.query.sortBy]: ... }` would let a caller order by any
 * column, which leaks information about columns they cannot read. Exported
 * because provider.schema.ts validates against the same tuple — one list, two
 * enforcement points.
 */
export const PROVIDER_SORT_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'speciality',
  'createdAt',
] as const;

export type ProviderSortField = (typeof PROVIDER_SORT_FIELDS)[number];

/** Fields the `search` term matches against. */
const PROVIDER_SEARCH_FIELDS = ['firstName', 'lastName', 'email'] as const;

/**
 * Provider persistence.
 *
 * A concrete class, not a `BaseRepository<T>`. The generic version would abstract
 * five one-line CRUD calls while forcing every entity to share one notion of
 * filtering and sorting — which is exactly the part that differs per entity.
 * The reusable logic lives in shared *functions* (buildSearchFilter,
 * buildOrderBy, withPrismaErrors) that this class composes.
 */
export class ProviderRepository {
  constructor(private readonly prisma: PrismaClientInstance) {}

  private client(tx?: PrismaTransactionClient): PrismaTransactionClient {
    return tx ?? this.prisma;
  }

  /** Builds the `where` clause from whitelisted filters only. */
  private buildWhere(filters: ProviderListFilters) {
    return {
      ...omitUndefined({
        isActive: filters.isActive,
        speciality: filters.speciality,
      }),
      ...buildSearchFilter(PROVIDER_SEARCH_FIELDS, filters.search),
    };
  }

  async findById(id: string, tx?: PrismaTransactionClient): Promise<ProviderRecord | null> {
    return withPrismaErrors('Provider', () =>
      this.client(tx).provider.findUnique({ where: { id } }),
    );
  }

  async findByEmail(email: string, tx?: PrismaTransactionClient): Promise<ProviderRecord | null> {
    return withPrismaErrors('Provider', () =>
      this.client(tx).provider.findUnique({ where: { email } }),
    );
  }

  /**
   * Page of providers plus the total.
   *
   * Both queries run inside one `$transaction` so the count matches the page
   * even if rows are inserted between them — otherwise a client can see
   * "showing 1-20 of 57" while page 3 is empty.
   */
  async findMany(
    filters: ProviderListFilters,
    pagination: PaginationParams,
    sortBy?: string,
    sortOrder: SortOrder = 'desc',
  ): Promise<PaginatedResult<ProviderRecord>> {
    const where = this.buildWhere(filters);
    const orderBy = buildOrderBy(PROVIDER_SORT_FIELDS, 'createdAt', sortBy, sortOrder);

    return withPrismaErrors('Provider', async () => {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.provider.findMany({
          where,
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
        }),
        this.prisma.provider.count({ where }),
      ]);

      return { items, total };
    });
  }

  /** Backs GET /providers/active. Served by the isActive index. */
  async findActive(
    pagination: PaginationParams,
    sortBy?: string,
    sortOrder: SortOrder = 'asc',
  ): Promise<PaginatedResult<ProviderRecord>> {
    return this.findMany({ isActive: true }, pagination, sortBy ?? 'lastName', sortOrder);
  }

  async count(filters: ProviderListFilters = {}): Promise<number> {
    return withPrismaErrors('Provider', () =>
      this.prisma.provider.count({ where: this.buildWhere(filters) }),
    );
  }

  async create(data: CreateProviderData, tx?: PrismaTransactionClient): Promise<ProviderRecord> {
    return withPrismaErrors('Provider', () =>
      this.client(tx).provider.create({
        // Every column is named. A stray key in the request body has no path here.
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          dateOfBirth: data.dateOfBirth,
          email: data.email,
          speciality: data.speciality,
          ...(data.isActive === undefined ? {} : { isActive: data.isActive }),
        },
      }),
    );
  }

  /** Bulk insert used by the transactional import example in the service. */
  async createMany(
    data: CreateProviderData[],
    tx?: PrismaTransactionClient,
  ): Promise<ProviderRecord[]> {
    return withPrismaErrors('Provider', async () => {
      const created: ProviderRecord[] = [];
      for (const item of data) {
        created.push(await this.create(item, tx));
      }
      return created;
    });
  }

  async update(
    id: string,
    data: UpdateProviderData,
    tx?: PrismaTransactionClient,
  ): Promise<ProviderRecord> {
    return withPrismaErrors('Provider', () =>
      this.client(tx).provider.update({
        where: { id },
        data: omitUndefined({
          firstName: data.firstName,
          lastName: data.lastName,
          dateOfBirth: data.dateOfBirth,
          email: data.email,
          speciality: data.speciality,
          isActive: data.isActive,
        }),
      }),
    );
  }

  /**
   * Hard delete.
   *
   * If you later switch to soft delete, this method and `buildWhere` are the two
   * places that change — every service and controller above stays untouched.
   * That is the reason repositories exist.
   */
  async delete(id: string, tx?: PrismaTransactionClient): Promise<void> {
    await withPrismaErrors('Provider', () => this.client(tx).provider.delete({ where: { id } }));
  }
}
