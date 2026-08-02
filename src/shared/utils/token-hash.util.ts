import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Hashing for refresh tokens before they are stored.
 *
 * Why SHA-256 and not Argon2 here, when passwords use Argon2: a refresh token is
 * a 200+ character high-entropy value that we generated, not a human-chosen
 * password. There is nothing to brute force, so the slow, memory-hard function
 * would only add latency to every refresh. What we need is that a stolen
 * database dump contains no usable tokens — a fast one-way hash gives exactly that.
 */

/** 64 lowercase hex characters — matches the Char(64) column. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of two hex hashes.
 *
 * Lookups go through the unique index on tokenHash, so this is only for the
 * rare direct comparison; using it keeps timing side channels off the table.
 */
export function compareTokenHash(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length || bufferA.length === 0) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** New rotation-chain id, issued once per login and carried through every rotation. */
export function generateFamilyId(): string {
  return randomUUID();
}
