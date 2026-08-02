import type { PrismaClientInstance, PrismaTransactionClient } from '@/database/prisma';
import { withPrismaErrors } from '@/shared/utils/prisma-error-mapper.util';
import type { CreateSessionData, RefreshSessionRecord } from '@/modules/auth/auth.types';

/**
 * Refresh session persistence.
 *
 * Rotated sessions are marked revoked, never deleted — the row is what lets us
 * recognise a replayed token later. A cleanup job removes rows past expiresAt.
 */
export class AuthRepository {
  constructor(private readonly prisma: PrismaClientInstance) {}

  private client(tx?: PrismaTransactionClient): PrismaTransactionClient {
    return tx ?? this.prisma;
  }

  async createSession(
    data: CreateSessionData,
    tx?: PrismaTransactionClient,
  ): Promise<RefreshSessionRecord> {
    return withPrismaErrors('Session', () =>
      this.client(tx).refreshSession.create({
        data: {
          id: data.id,
          userId: data.userId,
          tokenHash: data.tokenHash,
          familyId: data.familyId,
          expiresAt: data.expiresAt,
          ...(data.ipAddress ? { ipAddress: data.ipAddress } : {}),
          ...(data.userAgent ? { userAgent: data.userAgent } : {}),
        },
      }),
    );
  }

  /** Lookup is by token hash, which is uniquely indexed. */
  async findSessionByTokenHash(
    tokenHash: string,
    tx?: PrismaTransactionClient,
  ): Promise<RefreshSessionRecord | null> {
    return withPrismaErrors('Session', () =>
      this.client(tx).refreshSession.findUnique({ where: { tokenHash } }),
    );
  }

  /** Marks a session rotated: revoked, with a pointer to its successor. */
  async revokeSession(
    id: string,
    replacedByTokenHash: string | null,
    tx?: PrismaTransactionClient,
  ): Promise<void> {
    await withPrismaErrors('Session', () =>
      this.client(tx).refreshSession.update({
        where: { id },
        data: {
          revokedAt: new Date(),
          ...(replacedByTokenHash ? { replacedByTokenHash } : {}),
        },
      }),
    );
  }

  /**
   * Kills an entire rotation chain. Called when a already-rotated token is
   * presented again, which means either the old token or the new one is in an
   * attacker's hands and we cannot tell which.
   */
  async revokeFamily(familyId: string, tx?: PrismaTransactionClient): Promise<number> {
    const result = await withPrismaErrors('Session', () =>
      this.client(tx).refreshSession.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
    return result.count;
  }

  /** Used by logout-everywhere and after a password change. */
  async revokeAllForUser(
    userId: string,
    options: { exceptSessionId?: string } = {},
    tx?: PrismaTransactionClient,
  ): Promise<number> {
    const result = await withPrismaErrors('Session', () =>
      this.client(tx).refreshSession.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
        },
        data: { revokedAt: new Date() },
      }),
    );
    return result.count;
  }

  /** Housekeeping: drop rows that can no longer be presented. */
  async deleteExpiredSessions(before = new Date()): Promise<number> {
    const result = await withPrismaErrors('Session', () =>
      this.prisma.refreshSession.deleteMany({ where: { expiresAt: { lt: before } } }),
    );
    return result.count;
  }
}
