import type { PrismaClientInstance } from '@/database/prisma';
import { ConflictError, NotFoundError } from '@/errors';
import { buildPaginationMeta, getPagination } from '@/shared/utils/pagination.util';
import type { PaginationMeta } from '@/shared/response/response-envelope';
import type { ProviderRepository } from '@/modules/provider/provider.repository';
import { mapProvidersToResponse, mapProviderToResponse } from '@/modules/provider/provider.mapper';
import type { ProviderResponse } from '@/modules/provider/provider.types';
import type {
  CreateProviderInput,
  ListActiveProvidersQuery,
  ListProvidersQuery,
  UpdateProviderInput,
} from '@/modules/provider/provider.schema';

export interface PaginatedProviders {
  providers: ProviderResponse[];
  meta: PaginationMeta;
}

/**
 * Provider business rules.
 *
 * Depends on the repository interface, not on Prisma, and never touches Express.
 * That is what lets provider.service.test.ts exercise every rule below with a
 * plain object standing in for the repository — no database, no HTTP server.
 */
export class ProviderService {
  constructor(
    private readonly providerRepository: ProviderRepository,
    /** Needed to own the transaction boundary in `importProviders`. */
    private readonly prisma: PrismaClientInstance,
  ) {}

  async listProviders(query: ListProvidersQuery): Promise<PaginatedProviders> {
    const pagination = getPagination(query);

    // Filters are picked out by name. The query object is never forwarded whole.
    const { items, total } = await this.providerRepository.findMany(
      {
        search: query.search,
        isActive: query.isActive,
        speciality: query.speciality,
      },
      pagination,
      query.sortBy,
      query.sortOrder,
    );

    return {
      providers: mapProvidersToResponse(items),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  async listActiveProviders(query: ListActiveProvidersQuery): Promise<PaginatedProviders> {
    const pagination = getPagination(query);

    const { items, total } = await this.providerRepository.findActive(
      pagination,
      query.sortBy,
      query.sortOrder,
    );

    return {
      providers: mapProvidersToResponse(items),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  async getProviderById(id: string): Promise<ProviderResponse> {
    const provider = await this.providerRepository.findById(id);
    if (!provider) {
      throw new NotFoundError('Provider not found');
    }
    return mapProviderToResponse(provider);
  }

  async createProvider(input: CreateProviderInput): Promise<ProviderResponse> {
    // Business rule, stated once, here — not in the controller and not in the
    // repository. The unique index is the ultimate guarantee; this check exists
    // so the client gets a clear message rather than a mapped constraint error.
    const existing = await this.providerRepository.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('Provider with this email already exists');
    }

    const provider = await this.providerRepository.create({
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      email: input.email,
      speciality: input.speciality,
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    });

    return mapProviderToResponse(provider);
  }

  async updateProvider(id: string, input: UpdateProviderInput): Promise<ProviderResponse> {
    const existing = await this.providerRepository.findById(id);
    if (!existing) {
      throw new NotFoundError('Provider not found');
    }

    // Only check uniqueness when the email actually changes — otherwise a
    // no-op update of a provider's own record would conflict with itself.
    if (input.email && input.email !== existing.email) {
      const emailOwner = await this.providerRepository.findByEmail(input.email);
      if (emailOwner) {
        throw new ConflictError('Provider with this email already exists');
      }
    }

    const provider = await this.providerRepository.update(id, {
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      email: input.email,
      speciality: input.speciality,
      isActive: input.isActive,
    });

    return mapProviderToResponse(provider);
  }

  async deleteProvider(id: string): Promise<void> {
    const existing = await this.providerRepository.findById(id);
    if (!existing) {
      throw new NotFoundError('Provider not found');
    }

    await this.providerRepository.delete(id);
  }

  /**
   * -------------------------------------------------------------------------
   * Transaction example
   * -------------------------------------------------------------------------
   * Imports a batch of providers all-or-nothing: if the tenth row has a
   * duplicate email, the first nine are rolled back too, so a failed import
   * never leaves a half-loaded table.
   *
   * Note where the boundary sits. The *service* opens the transaction, because
   * "these operations belong together" is a business statement. The repository
   * only accepts the transaction client it is handed — it never opens one, never
   * commits, and works identically inside or outside a transaction. Push the
   * boundary down into the repository and you can no longer compose two
   * repositories into one atomic operation.
   */
  async importProviders(inputs: CreateProviderInput[]): Promise<ProviderResponse[]> {
    const emails = inputs.map((input) => input.email);
    const duplicatesInPayload = emails.filter((email, index) => emails.indexOf(email) !== index);
    if (duplicatesInPayload.length > 0) {
      throw new ConflictError(
        `Duplicate emails in request: ${[...new Set(duplicatesInPayload)].join(', ')}`,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const results = [];

      for (const input of inputs) {
        const existing = await this.providerRepository.findByEmail(input.email, tx);
        if (existing) {
          // Throwing inside the callback rolls the whole transaction back.
          throw new ConflictError(`Provider with email ${input.email} already exists`);
        }

        results.push(
          await this.providerRepository.create(
            {
              firstName: input.firstName,
              lastName: input.lastName,
              dateOfBirth: input.dateOfBirth,
              email: input.email,
              speciality: input.speciality,
              ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
            },
            tx,
          ),
        );
      }

      return results;
    });

    return mapProvidersToResponse(created);
  }
}
