import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderService } from '@/modules/provider/provider.service';
import type { ProviderRepository } from '@/modules/provider/provider.repository';
import type { PrismaClientInstance } from '@/database/prisma';
import type { ProviderRecord } from '@/modules/provider/provider.types';
import { ConflictError, NotFoundError } from '@/errors';

/**
 * Service unit tests.
 *
 * No database, no Express, no Prisma — the repository is a plain object of
 * mocks. That is possible only because ProviderService takes its repository
 * through the constructor and never imports a singleton, and it is the payoff
 * of the layering: every business rule below is verified in milliseconds.
 */

function buildProvider(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    firstName: 'Ada',
    lastName: 'Okafor',
    dateOfBirth: new Date('1981-03-14T00:00:00.000Z'),
    email: 'ada.okafor@example.com',
    speciality: 'Cardiology',
    isActive: true,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** Only the methods the service actually calls need to exist. */
function createMockRepository() {
  return {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findMany: vi.fn(),
    findActive: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  };
}

describe('ProviderService', () => {
  let repository: ReturnType<typeof createMockRepository>;
  let service: ProviderService;

  beforeEach(() => {
    repository = createMockRepository();

    // A stand-in Prisma client whose $transaction just runs the callback. The
    // service only needs it to own a transaction boundary; the boundary's real
    // behaviour is covered by the integration suite against a live database.
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({})),
    };

    service = new ProviderService(
      repository as unknown as ProviderRepository,
      prisma as unknown as PrismaClientInstance,
    );
  });

  describe('createProvider', () => {
    const input = {
      firstName: 'Ada',
      lastName: 'Okafor',
      dateOfBirth: new Date('1981-03-14T00:00:00.000Z'),
      email: 'ada.okafor@example.com',
      speciality: 'Cardiology',
    };

    it('creates a provider when the email is free', async () => {
      repository.findByEmail.mockResolvedValue(null);
      repository.create.mockResolvedValue(buildProvider());

      const result = await service.createProvider(input);

      expect(repository.findByEmail).toHaveBeenCalledWith('ada.okafor@example.com');
      expect(result.email).toBe('ada.okafor@example.com');
      expect(result.fullName).toBe('Ada Okafor');
      // dateOfBirth is a date-only column and must not serialise as a timestamp.
      expect(result.dateOfBirth).toBe('1981-03-14');
    });

    it('throws ConflictError when a provider with that email exists', async () => {
      repository.findByEmail.mockResolvedValue(buildProvider());

      await expect(service.createProvider(input)).rejects.toThrow(ConflictError);
      await expect(service.createProvider(input)).rejects.toThrow(
        'Provider with this email already exists',
      );

      // The duplicate must be rejected before any write is attempted.
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('passes only whitelisted fields to the repository', async () => {
      repository.findByEmail.mockResolvedValue(null);
      repository.create.mockResolvedValue(buildProvider());

      // A caller that smuggles extra keys past validation must still not get
      // them into the database — the service names every field it writes.
      await service.createProvider({
        ...input,
        id: 'attacker-supplied',
        isActive: true,
        createdAt: new Date(0),
      } as never);

      const written = repository.create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(Object.keys(written).sort()).toEqual(
        ['dateOfBirth', 'email', 'firstName', 'isActive', 'lastName', 'speciality'].sort(),
      );
      expect(written['id']).toBeUndefined();
      expect(written['createdAt']).toBeUndefined();
    });
  });

  describe('getProviderById', () => {
    it('returns the mapped provider', async () => {
      repository.findById.mockResolvedValue(buildProvider());

      const result = await service.getProviderById('11111111-1111-4111-8111-111111111111');

      expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
      expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('throws NotFoundError when the provider does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getProviderById('missing')).rejects.toThrow(NotFoundError);
      await expect(service.getProviderById('missing')).rejects.toThrow('Provider not found');
    });
  });

  describe('updateProvider', () => {
    it('throws NotFoundError when the provider does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.updateProvider('missing', { firstName: 'New' })).rejects.toThrow(
        NotFoundError,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('allows an update that keeps the same email', async () => {
      const existing = buildProvider();
      repository.findById.mockResolvedValue(existing);
      repository.update.mockResolvedValue({ ...existing, speciality: 'Neurology' });

      const result = await service.updateProvider(existing.id, {
        email: existing.email,
        speciality: 'Neurology',
      });

      // Uniqueness must not be checked when the email is unchanged, or a no-op
      // update would conflict with the record's own row.
      expect(repository.findByEmail).not.toHaveBeenCalled();
      expect(result.speciality).toBe('Neurology');
    });

    it('throws ConflictError when changing to an email another provider owns', async () => {
      const existing = buildProvider();
      repository.findById.mockResolvedValue(existing);
      repository.findByEmail.mockResolvedValue(
        buildProvider({ id: 'other-id', email: 'taken@example.com' }),
      );

      await expect(
        service.updateProvider(existing.id, { email: 'taken@example.com' }),
      ).rejects.toThrow(ConflictError);
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteProvider', () => {
    it('deletes an existing provider', async () => {
      repository.findById.mockResolvedValue(buildProvider());
      repository.delete.mockResolvedValue(undefined);

      await service.deleteProvider('11111111-1111-4111-8111-111111111111');

      expect(repository.delete).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    });

    it('throws NotFoundError rather than silently succeeding', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.deleteProvider('missing')).rejects.toThrow(NotFoundError);
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });

  describe('listProviders', () => {
    it('forwards only whitelisted filters and returns pagination metadata', async () => {
      repository.findMany.mockResolvedValue({ items: [buildProvider()], total: 42 });

      const result = await service.listProviders({
        page: 2,
        pageSize: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        search: 'ada',
        isActive: true,
        speciality: 'Cardiology',
      });

      const [filters, pagination] = repository.findMany.mock.calls[0] ?? [];
      expect(filters).toEqual({ search: 'ada', isActive: true, speciality: 'Cardiology' });
      expect(pagination).toEqual({ skip: 20, take: 20, page: 2, pageSize: 20 });

      expect(result.meta).toEqual({
        page: 2,
        pageSize: 20,
        total: 42,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });
  });
});
