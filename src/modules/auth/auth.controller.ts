import type { Request, Response } from 'express';
import { sendCreated, sendNoContent, sendSuccess } from '@/shared/response/send-response.util';
import { requireAuthenticatedUser } from '@/shared/utils/auth-context.util';
import type { AuthService } from '@/modules/auth/auth.service';
import type { SessionContext } from '@/modules/auth/auth.types';
import type {
  ChangePasswordInput,
  LoginInput,
  LogoutInput,
  RefreshInput,
  RegisterInput,
} from '@/modules/auth/auth.schema';

/**
 * ---------------------------------------------------------------------------
 * Token transport
 * ---------------------------------------------------------------------------
 * Refresh tokens are returned in the JSON body, not set as an httpOnly cookie.
 *
 * This is a general-purpose API template: its consumers include browser SPAs,
 * native mobile apps and server-to-server clients. Cookies only exist for the
 * first of those, and choosing them here would force CORS credentials, SameSite
 * and CSRF decisions onto every project that clones this — decisions that
 * depend on a frontend this repository does not know about.
 *
 * The tradeoff: a body-delivered token is reachable by JavaScript, so an XSS bug
 * in a browser client can steal it. That is mitigated at the protocol level
 * instead — rotation, hashing at rest, and family revocation on reuse (see
 * AuthService) — and browser clients should hold the token in memory rather
 * than localStorage.
 *
 * To switch to cookies: set the cookie here instead of returning the field, and
 * read it from `req.cookies` in `refresh`/`logout`. The service layer is
 * unchanged. Add CSRF protection when you do.
 */
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private sessionContext(req: Request): SessionContext {
    const userAgent = req.get('user-agent');
    return {
      ...(req.ip ? { ipAddress: req.ip } : {}),
      ...(userAgent ? { userAgent } : {}),
    };
  }

  register = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as RegisterInput;
    const result = await this.authService.register(input, this.sessionContext(req));
    sendCreated(res, result, 'Account created successfully.');
  };

  login = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as LoginInput;
    const result = await this.authService.login(input, this.sessionContext(req));
    sendSuccess(res, result, 'Logged in successfully.');
  };

  refresh = async (req: Request, res: Response): Promise<void> => {
    const { refreshToken } = req.body as RefreshInput;
    const result = await this.authService.refresh(refreshToken, this.sessionContext(req));
    sendSuccess(res, result, 'Session refreshed.');
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    const { refreshToken, allDevices } = req.body as LogoutInput;
    await this.authService.logout(refreshToken, allDevices);
    sendNoContent(res);
  };

  me = async (req: Request, res: Response): Promise<void> => {
    const { id } = requireAuthenticatedUser(req);
    // Not UserService.getProfile: the client needs its permission keys to decide
    // what to render, and those belong to the session rather than the record.
    const user = await this.authService.getSessionUser(id);
    sendSuccess(res, user);
  };

  changePassword = async (req: Request, res: Response): Promise<void> => {
    const { id } = requireAuthenticatedUser(req);
    const input = req.body as ChangePasswordInput;

    // If the client sends its current refresh token, that one session is kept
    // alive so the user is not signed out of the device they are using.
    const currentRefreshToken = (req.body as { refreshToken?: string }).refreshToken;

    await this.authService.changePassword(id, input, currentRefreshToken);
    sendSuccess(res, null, 'Password changed successfully. Other sessions have been signed out.');
  };
}
