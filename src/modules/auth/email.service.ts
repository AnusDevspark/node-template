import { logger } from '@/config/logger';

/**
 * Email delivery, behind an interface.
 *
 * No provider is wired up, because a starter should not force a vendor choice.
 * What matters is that the *shape* is fixed now: AuthService depends on this
 * interface, so adding Resend, Postmark or SES later is a new implementation
 * class and one line of wiring — no change to any auth flow.
 *
 * The same pattern applies to the other external services this template does
 * not implement (StorageService, PaymentGateway). See docs/architecture.md.
 */

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailService {
  send(options: SendEmailOptions): Promise<void>;
  sendPasswordReset(to: string, resetToken: string): Promise<void>;
  sendEmailVerification(to: string, verificationToken: string): Promise<void>;
}

/**
 * Development implementation: logs instead of sending.
 *
 * Tokens are logged at debug level and never at info, so they do not end up in
 * a production log aggregator if this is left enabled by mistake.
 */
export class ConsoleEmailService implements EmailService {
  async send(options: SendEmailOptions): Promise<void> {
    logger.info({ to: options.to, subject: options.subject }, 'email (not sent — console driver)');
  }

  async sendPasswordReset(to: string, resetToken: string): Promise<void> {
    logger.debug({ to, resetToken }, 'password reset token generated');
    await this.send({
      to,
      subject: 'Reset your password',
      text: 'A password reset was requested for your account.',
    });
  }

  async sendEmailVerification(to: string, verificationToken: string): Promise<void> {
    logger.debug({ to, verificationToken }, 'email verification token generated');
    await this.send({
      to,
      subject: 'Verify your email address',
      text: 'Please verify your email address.',
    });
  }
}
