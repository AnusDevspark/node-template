import type { AuthenticatedUser } from '@/shared/types/authenticated-user.type';

/**
 * Express Request augmentation.
 *
 * This is what lets `req.user.id` typecheck without a cast anywhere in the
 * codebase. `user` is optional at the type level because it genuinely is absent
 * before the authenticate middleware runs — `requireAuthenticatedUser(req)` in
 * auth-context.util.ts is the narrowing helper that turns the optional into a
 * guaranteed value inside protected handlers.
 *
 * `req.id` is deliberately NOT declared here: pino-http already augments Request
 * with `id: ReqId` (string | number), and a second declaration with a narrower
 * type is a compile error. Our request-id middleware always assigns a string;
 * call sites that need one coerce with `String(req.id)`.
 */
declare global {
  namespace Express {
    interface Request {
      /** Set by the authenticate middleware. Absent on public routes. */
      user?: AuthenticatedUser;
    }
  }
}

export {};
