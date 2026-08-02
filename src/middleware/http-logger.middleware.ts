import { pinoHttp } from 'pino-http';
import type { RequestHandler } from 'express';
import { logger } from '@/config/logger';
import { DOCS_PATH } from '@/config/constants';

/**
 * One structured log line per request: requestId, method, path, status, duration.
 *
 * Request and response *bodies* are deliberately never logged. A global body
 * logger will eventually capture a password, a token, or personal data — if a
 * specific endpoint needs payload logging, it should opt in explicitly and
 * redact its own fields.
 */
export const httpLogger: RequestHandler = pinoHttp({
  logger,

  // Reuse the id assigned by request-id middleware so app logs and request logs
  // share one correlation value.
  genReqId: (req) => (req as { id?: string }).id ?? '',

  // 4xx is the client's problem, not an application fault — keep it at warn so
  // error-level alerting stays meaningful.
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },

  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} ${res.statusCode} ${err.message}`,

  // Health checks and docs assets run constantly and drown real traffic.
  autoLogging: {
    ignore: (req) => {
      const url = req.url ?? '';
      return url.startsWith('/health') || url.startsWith(DOCS_PATH);
    },
  },

  // Explicit serialisers: log the few fields that help debugging, never the
  // whole header bag (which contains Authorization and Cookie).
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: req.remoteAddress,
      userAgent: req.headers?.['user-agent'],
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
