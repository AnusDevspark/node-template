/**
 * JWT payload shapes.
 *
 * What belongs in a JWT: an identifier the API needs on *every* request, that is
 * stable for the token's lifetime, and that is not secret. `sub`, `email` and
 * `role` qualify — they let authenticate and authorizeRoles work without a
 * database round trip.
 *
 * What does not belong:
 *   - Anything secret. A JWT is signed, not encrypted; anyone holding it can
 *     read the payload. No password hashes, no PII beyond what the client
 *     already knows about itself, no internal flags.
 *   - Anything volatile. A permission list embedded at login stays stale until
 *     the token expires, so revoking a permission would not take effect for 15
 *     minutes. Permissions are resolved per-request from the database instead.
 *   - Anything large. The token travels on every request.
 */

/** Distinguishes the two token types so an access token cannot be used to refresh. */
export const TOKEN_TYPES = {
  ACCESS: 'access',
  REFRESH: 'refresh',
} as const;

export type TokenType = (typeof TOKEN_TYPES)[keyof typeof TOKEN_TYPES];

/** Claims we set. `sub` is the user id, per RFC 7519. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  type: typeof TOKEN_TYPES.ACCESS;
}

/**
 * The refresh token carries almost nothing: the session id (`jti`) and family
 * are what actually matter, and both are verified against the database on use.
 * The JWT signature alone never authorises a refresh.
 */
export interface RefreshTokenPayload {
  sub: string;
  /** RefreshSession.id — links the token to its database row. */
  jti: string;
  /** Rotation chain id, used for replay detection. */
  fid: string;
  type: typeof TOKEN_TYPES.REFRESH;
}

/** Claims jsonwebtoken adds automatically. */
export interface RegisteredClaims {
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export type VerifiedAccessToken = AccessTokenPayload & RegisteredClaims;
export type VerifiedRefreshToken = RefreshTokenPayload & RegisteredClaims;
