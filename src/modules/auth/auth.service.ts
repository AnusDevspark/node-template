import { randomUUID } from 'node:crypto';
import { UserStatus } from '@/generated/prisma/enums';
import type { PrismaClientInstance } from '@/database/prisma';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { ConflictError, ERROR_CODES, NotFoundError, UnauthorizedError } from '@/errors';
import { comparePassword, hashPassword } from '@/shared/utils/password.util';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '@/shared/utils/jwt.util';
import { generateFamilyId, hashToken } from '@/shared/utils/token-hash.util';
import { ROLES } from '@/shared/constants/roles.constant';
import type { UserRepository } from '@/modules/user/user.repository';
import { mapUserToSessionResponse } from '@/modules/user/user.mapper';
import type { SessionUserResponse, UserWithRole } from '@/modules/user/user.types';
import type { RbacService } from '@/modules/rbac/rbac.service';
import type { AuthRepository } from '@/modules/auth/auth.repository';
import type { EmailService } from '@/modules/auth/email.service';
import type { AuthResult, AuthTokens, SessionContext } from '@/modules/auth/auth.types';
import type { ChangePasswordInput, LoginInput, RegisterInput } from '@/modules/auth/auth.schema';

/**
 * Authentication business logic.
 *
 * ---------------------------------------------------------------------------
 * Refresh token design
 * ---------------------------------------------------------------------------
 * A JWT alone cannot be revoked, so a long-lived refresh token that is only a
 * JWT means a stolen token is valid until it expires. This implementation backs
 * every refresh token with a database row and applies three controls:
 *
 * 1. HASHED AT REST. Only the SHA-256 of the token is stored, so a database
 *    dump yields nothing replayable.
 *
 * 2. ROTATION. Every refresh issues a new token and revokes the one presented.
 *    A token is therefore usable exactly once, which shrinks the window in
 *    which a stolen token is worth anything to a single request.
 *
 * 3. REUSE DETECTION. Because rotated rows are kept (revoked, not deleted),
 *    presenting an already-rotated token is detectable — and it means the token
 *    was captured, since the legitimate client would have moved on to the
 *    successor. We cannot tell whether the attacker or the victim is presenting
 *    it, so the entire rotation family is revoked and both are forced to log in
 *    again. Losing a session is the correct trade against leaving one hijacked.
 *
 * The cost of this design is one indexed read plus a small write on each
 * refresh — every 15 minutes per active client, not per request.
 */
export class AuthService {
  constructor(
    private readonly prisma: PrismaClientInstance,
    private readonly userRepository: UserRepository,
    private readonly authRepository: AuthRepository,
    private readonly rbacService: RbacService,
    private readonly emailService: EmailService,
  ) {}

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  async register(input: RegisterInput, context: SessionContext = {}): Promise<AuthResult> {
    const existing = await this.userRepository.findByEmail(input.email);
    if (existing) {
      // Registration is one of the few places where revealing that an account
      // exists is the lesser evil: the alternative is silently doing nothing,
      // which leaves a legitimate user stuck with no explanation. The login and
      // password-reset flows, where enumeration actually helps an attacker, do
      // not reveal it.
      throw new ConflictError('An account with this email already exists', 'email');
    }

    // Self-service signup always gets the standard role. The request cannot
    // influence this — `role` is not in the register schema at all.
    const roleId = await this.userRepository.findRoleIdByName(ROLES.USER);
    if (!roleId) {
      throw new NotFoundError(
        'Default role is missing. Run `npm run prisma:seed` to create the default roles.',
      );
    }

    const passwordHash = await hashPassword(input.password);

    const user = await this.userRepository.create({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      passwordHash,
      roleId,
    });

    const tokens = await this.issueSession(user, generateFamilyId(), context);

    logger.info({ userId: user.id }, 'user registered');

    return { user: await this.toSessionUser(user), tokens };
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  async login(input: LoginInput, context: SessionContext = {}): Promise<AuthResult> {
    const user = await this.userRepository.findByEmail(input.email);

    // Identical error for "no such account" and "wrong password". Anything else
    // turns the login endpoint into an account-enumeration oracle.
    //
    // A timing difference remains — a missing user skips the Argon2 verify and
    // answers faster. `verifyDummyPassword` below burns equivalent time so the
    // two paths are indistinguishable.
    if (!user) {
      await this.burnPasswordVerificationTime();
      throw new UnauthorizedError(
        'Invalid email or password',
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      );
    }

    const passwordMatches = await comparePassword(input.password, user.passwordHash);
    if (!passwordMatches) {
      logger.warn({ userId: user.id }, 'failed login attempt');
      throw new UnauthorizedError(
        'Invalid email or password',
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      );
    }

    // Status is checked *after* the password, so a wrong password against a
    // suspended account still returns the generic credentials error rather than
    // confirming the account exists.
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedError(
        'This account is not active. Contact an administrator.',
        ERROR_CODES.AUTH_ACCOUNT_DISABLED,
      );
    }

    const tokens = await this.issueSession(user, generateFamilyId(), context);

    logger.info({ userId: user.id }, 'user logged in');

    return { user: await this.toSessionUser(user), tokens };
  }

  // -------------------------------------------------------------------------
  // Refresh
  // -------------------------------------------------------------------------

  /**
   * Rotates a refresh token.
   *
   * The signature check is necessary but not sufficient: the token must also
   * correspond to a live session row. The whole rotate-and-revoke step runs in
   * one transaction, so a crash cannot leave two valid tokens or zero.
   */
  async refresh(refreshToken: string, context: SessionContext = {}): Promise<AuthResult> {
    const payload = verifyRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);

    const session = await this.authRepository.findSessionByTokenHash(tokenHash);

    if (!session) {
      // Correctly signed but unknown to us: the session was deleted by cleanup,
      // or the token was minted with a leaked secret.
      throw new UnauthorizedError('Invalid refresh token', ERROR_CODES.AUTH_TOKEN_INVALID);
    }

    // --- Reuse detection ---------------------------------------------------
    if (session.revokedAt !== null) {
      const revokedCount = await this.authRepository.revokeFamily(session.familyId);

      logger.error(
        { userId: session.userId, familyId: session.familyId, revokedCount },
        'refresh token reuse detected — revoking entire session family',
      );

      throw new UnauthorizedError(
        'This session has been revoked. Please sign in again.',
        ERROR_CODES.AUTH_SESSION_REVOKED,
      );
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError('Refresh token has expired', ERROR_CODES.AUTH_TOKEN_EXPIRED);
    }

    const user = await this.userRepository.findById(session.userId);
    if (!user) {
      throw new UnauthorizedError('Invalid refresh token', ERROR_CODES.AUTH_TOKEN_INVALID);
    }

    // Re-check status on refresh, otherwise suspending an account would not take
    // effect until the refresh token expired.
    if (user.status !== UserStatus.ACTIVE) {
      await this.authRepository.revokeFamily(session.familyId);
      throw new UnauthorizedError(
        'This account is not active. Contact an administrator.',
        ERROR_CODES.AUTH_ACCOUNT_DISABLED,
      );
    }

    // --- Rotation (atomic) -------------------------------------------------
    // The new token stays in the same family, so a replay of *any* token in the
    // chain still takes the whole chain down.
    const tokens = await this.prisma.$transaction(async (tx) => {
      const issued = await this.issueSession(user, payload.fid, context, tx);
      await this.authRepository.revokeSession(session.id, hashToken(issued.refreshToken), tx);
      return issued;
    });

    return { user: await this.toSessionUser(user), tokens };
  }

  // -------------------------------------------------------------------------
  // Current session
  // -------------------------------------------------------------------------

  /**
   * The caller's own profile plus their permission keys — what GET /auth/me
   * returns.
   *
   * This lives here rather than on UserService because it describes a *session*,
   * not a user record: UserService.getProfile answers "who is this person",
   * this answers "what can the person holding this token do right now".
   */
  async getSessionUser(userId: string): Promise<SessionUserResponse> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    return this.toSessionUser(user);
  }

  // -------------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------------

  /**
   * Revokes the presented session, or every session for the user.
   *
   * Logout never fails on an unknown token: a client trying to clean up after
   * an already-expired session should get a success, and telling a caller
   * whether a token was real is a small enumeration leak for no benefit.
   */
  async logout(refreshToken: string, allDevices = false): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    const session = await this.authRepository.findSessionByTokenHash(tokenHash);

    if (!session) return;

    if (allDevices) {
      const count = await this.authRepository.revokeAllForUser(session.userId);
      logger.info({ userId: session.userId, count }, 'logged out of all devices');
      return;
    }

    if (session.revokedAt === null) {
      await this.authRepository.revokeSession(session.id, null);
    }

    logger.info({ userId: session.userId }, 'user logged out');
  }

  // -------------------------------------------------------------------------
  // Change password
  // -------------------------------------------------------------------------

  /**
   * Changes a password and invalidates every other session.
   *
   * This is the expected behaviour of a password change: the usual reason to
   * change one is that it may be compromised, so leaving other sessions alive
   * would defeat the point. The session the caller is using survives, so they
   * are not logged out of the device they just used — that is a deliberate
   * usability choice; pass no exception if you prefer to force a full re-login.
   *
   * Note that already-issued *access* tokens stay valid until they expire.
   * That is inherent to stateless JWTs and is why the access lifetime is short.
   */
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    currentRefreshToken?: string,
  ): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const matches = await comparePassword(input.currentPassword, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedError(
        'Current password is incorrect',
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      );
    }

    const passwordHash = await hashPassword(input.newPassword);

    // Keep the caller's current session alive if they told us which it is.
    let exceptSessionId: string | undefined;
    if (currentRefreshToken) {
      const session = await this.authRepository.findSessionByTokenHash(
        hashToken(currentRefreshToken),
      );
      if (session && session.userId === userId) {
        exceptSessionId = session.id;
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await this.userRepository.update(userId, { passwordHash }, tx);
      await this.authRepository.revokeAllForUser(
        userId,
        exceptSessionId ? { exceptSessionId } : {},
        tx,
      );
    });

    logger.info({ userId }, 'password changed, other sessions revoked');
  }

  // -------------------------------------------------------------------------
  // Not implemented — architected for, deliberately left out
  // -------------------------------------------------------------------------

  /**
   * Password reset and email verification are NOT wired to routes.
   *
   * Everything they need is already here — a token table pattern (RefreshSession
   * shows it), hashing utilities, and EmailService — but both need product
   * decisions this template should not make: token lifetime, whether an
   * unverified account may log in, what the reset link points at. Implementing
   * them is a new schema model plus two endpoints; no change to the flows above.
   *
   * The one rule to keep: the request-reset endpoint must return the same
   * response whether or not the address exists, or it becomes an account
   * enumeration oracle.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);

    // Always the same outcome from the caller's perspective.
    if (!user) {
      logger.debug({ email }, 'password reset requested for unknown address');
      return;
    }

    logger.info({ userId: user.id }, 'password reset requested');
    // A real implementation persists a hashed, single-use, short-lived token.
    await this.emailService.sendPasswordReset(user.email, 'not-implemented');
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Attaches the role's permission keys to a user DTO.
   *
   * RbacService caches per role for 60s, so the four call sites here cost at
   * most one query per role per minute rather than one per login.
   */
  private async toSessionUser(user: UserWithRole): Promise<SessionUserResponse> {
    const permissions = await this.rbacService.getPermissionsForRole(user.role.name);
    return mapUserToSessionResponse(user, permissions);
  }

  /**
   * Signs a token pair and records the refresh session.
   *
   * The session id is generated up front so it can go into the JWT's `jti`
   * before the row exists, which keeps the token and its row in sync without a
   * second write.
   */
  private async issueSession(
    user: UserWithRole,
    familyId: string,
    context: SessionContext,
    tx?: Parameters<Parameters<PrismaClientInstance['$transaction']>[0]>[0],
  ): Promise<AuthTokens> {
    const sessionId = randomUUID();

    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role.name,
    });

    const refreshToken = signRefreshToken({
      sub: user.id,
      jti: sessionId,
      fid: familyId,
    });

    await this.authRepository.createSession(
      {
        id: sessionId,
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + parseDurationMs(env.JWT_REFRESH_EXPIRES_IN)),
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        ...(context.userAgent ? { userAgent: context.userAgent.slice(0, 255) } : {}),
      },
      tx,
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(parseDurationMs(env.JWT_ACCESS_EXPIRES_IN) / 1000),
      tokenType: 'Bearer',
    };
  }

  /**
   * Spends roughly the time an Argon2 verification would, so a login against a
   * non-existent account is not measurably faster than one against a real
   * account with a wrong password.
   */
  private async burnPasswordVerificationTime(): Promise<void> {
    // A fixed, meaningless hash — verifying it always fails, and costs the same
    // as a genuine check.
    await comparePassword(
      'timing-equalisation',
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2E$3g2Zx1s6Q9m0v8k6uYt7cLZ5aWq0jK1nR4pT8sVwXyE',
    );
  }
}

/**
 * Converts "15m" / "7d" / "3600" into milliseconds.
 *
 * jsonwebtoken accepts these strings for `expiresIn` but does not export a
 * parser, and we need the same value to compute the session's expiresAt.
 */
export function parseDurationMs(duration: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y)?$/i.exec(duration.trim());
  if (!match?.[1]) {
    throw new Error(`Invalid duration: ${duration}`);
  }

  const value = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    y: 31_536_000_000,
  };

  return value * (multipliers[unit] ?? 1000);
}
