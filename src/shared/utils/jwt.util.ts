import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '@/config/env';
import { ERROR_CODES, UnauthorizedError } from '@/errors';
import {
  TOKEN_TYPES,
  type AccessTokenPayload,
  type RefreshTokenPayload,
  type VerifiedAccessToken,
  type VerifiedRefreshToken,
} from '@/shared/types/jwt-payload.type';

/**
 * Token signing and verification.
 *
 * Access and refresh tokens are signed with *different* secrets, so compromising
 * the access secret does not let an attacker mint refresh tokens. Both carry an
 * explicit `type` claim that is checked on verification — without it, an access
 * token signed with a shared secret could be replayed at the refresh endpoint.
 *
 * `issuer` and `audience` are verified too. They cost nothing and stop a token
 * minted for another service in the same trust domain from being accepted here.
 */

const baseSignOptions = {
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  algorithm: 'HS256',
} satisfies SignOptions;

export function signAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: TOKEN_TYPES.ACCESS }, env.JWT_ACCESS_SECRET, {
    ...baseSignOptions,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: TOKEN_TYPES.REFRESH }, env.JWT_REFRESH_SECRET, {
    ...baseSignOptions,
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

/**
 * Verifies signature, expiry, issuer, audience and token type.
 *
 * Always throws an UnauthorizedError rather than a raw JWT error, so callers
 * never have to know which library produced the failure. The distinct
 * AUTH_TOKEN_EXPIRED code matters: a client should silently refresh on expiry
 * but log the user out on a genuinely invalid token.
 */
export function verifyAccessToken(token: string): VerifiedAccessToken {
  let decoded: unknown;

  try {
    decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Access token has expired', ERROR_CODES.AUTH_TOKEN_EXPIRED);
    }
    throw new UnauthorizedError('Invalid access token', ERROR_CODES.AUTH_TOKEN_INVALID);
  }

  const payload = decoded as Partial<VerifiedAccessToken>;
  if (payload.type !== TOKEN_TYPES.ACCESS || !payload.sub) {
    throw new UnauthorizedError('Invalid access token', ERROR_CODES.AUTH_TOKEN_INVALID);
  }

  return payload as VerifiedAccessToken;
}

export function verifyRefreshToken(token: string): VerifiedRefreshToken {
  let decoded: unknown;

  try {
    decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Refresh token has expired', ERROR_CODES.AUTH_TOKEN_EXPIRED);
    }
    throw new UnauthorizedError('Invalid refresh token', ERROR_CODES.AUTH_TOKEN_INVALID);
  }

  const payload = decoded as Partial<VerifiedRefreshToken>;
  if (payload.type !== TOKEN_TYPES.REFRESH || !payload.sub || !payload.jti || !payload.fid) {
    throw new UnauthorizedError('Invalid refresh token', ERROR_CODES.AUTH_TOKEN_INVALID);
  }

  return payload as VerifiedRefreshToken;
}

/** Parses "Bearer <token>". Returns undefined rather than throwing so the caller picks the error. */
export function extractBearerToken(authorizationHeader?: string): string | undefined {
  if (!authorizationHeader) return undefined;

  const [scheme, token] = authorizationHeader.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return undefined;

  return token.trim() || undefined;
}
