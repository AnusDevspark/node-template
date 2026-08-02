import { z } from 'zod';
import { emailSchema, passwordSchema, personNameSchema } from '@/shared/validation/common.schema';

/**
 * Auth request validation.
 *
 * Note what registration does *not* accept: role, status, id. Self-service
 * signup always produces a standard USER — a client that posts `"role":"ADMIN"`
 * has that key stripped by Zod before the service ever sees it.
 */

export const registerSchema = z.object({
  firstName: personNameSchema,
  lastName: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

/**
 * Login deliberately does not apply the password policy. Validating an existing
 * password against current rules would reject users whose password predates a
 * policy change, and the length of the rejection tells an attacker about the
 * policy. Any non-empty string is accepted and then simply fails to verify.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'password is required').max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
  /** Revoke every session for this user, not just the current one. */
  allDevices: z.boolean().optional().default(false),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'currentPassword is required').max(128),
    newPassword: passwordSchema,
    /**
     * Optional. Send the refresh token of the device making the request and that
     * one session survives the password change; omit it and every session is
     * revoked, including this one.
     */
    refreshToken: z.string().min(1).optional(),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'new password must be different from the current password',
    path: ['newPassword'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
