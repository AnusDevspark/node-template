import pino, { type LoggerOptions } from 'pino';
import { env } from '@/config/env';
import { SERVICE_NAME } from '@/config/constants';

/**
 * The one logger instance. `console.log` is banned by ESLint in src/ — structured
 * logs are what makes production debugging possible.
 *
 * The redaction list below is the last line of defence, not the first: the code
 * should not be handing secrets to the logger at all. But request-logging
 * middleware serialises whole header objects, so this guarantees that an
 * Authorization header or a password field can never reach a log sink.
 */
const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'currentPassword',
  '*.currentPassword',
  'newPassword',
  '*.newPassword',
  'passwordHash',
  '*.passwordHash',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'tokenHash',
  '*.tokenHash',
];

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: SERVICE_NAME, env: env.NODE_ENV },
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    // Emit `"level":"info"` rather than `"level":30` so log search is readable.
    level: (label) => ({ level: label }),
  },
};

// Pretty output is a development convenience only. In production logs must stay
// newline-delimited JSON so the log shipper can parse them.
export const logger = env.LOG_PRETTY
  ? pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,service',
        },
      },
    })
  : pino(options);

export type Logger = typeof logger;
