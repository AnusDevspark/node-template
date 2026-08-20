import type { SessionUserResponse } from '@/modules/user/user.types';

/** What the auth module returns and stores. */

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires, so a client can schedule a refresh. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthResult {
  user: SessionUserResponse;
  tokens: AuthTokens;
}

/** Optional client fingerprint recorded against a session. */
export interface SessionContext {
  ipAddress?: string;
  userAgent?: string;
}

/** A refresh session row, as the repository returns it. */
export interface RefreshSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  revokedAt: Date | null;
  replacedByTokenHash: string | null;
  expiresAt: Date;
  createdAt: Date;
}

/** Explicitly whitelisted fields written when a session is created. */
export interface CreateSessionData {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}
