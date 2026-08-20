import type { Request, Response } from 'express';
import { ERROR_CODES } from '@/errors';
import { isDatabaseReachable } from '@/database/prisma';
import { env } from '@/config/env';
import { SERVICE_NAME, SERVICE_VERSION } from '@/config/constants';

/**
 * Health endpoints, and the difference between them.
 *
 * GET /health/live  — LIVENESS. "Is this process alive?" It checks nothing
 *   external on purpose. An orchestrator restarts a container that fails its
 *   liveness probe, so making this depend on the database means a brief database
 *   outage triggers a restart storm across every instance — turning a recoverable
 *   problem into an outage.
 *
 * GET /health/ready — READINESS. "Can this instance serve traffic right now?"
 *   This one does check the database, because an instance that cannot reach it
 *   should be pulled out of the load balancer rotation. It stays running and
 *   rejoins automatically when the check passes again.
 *
 * GET /health      — human-friendly summary of both.
 *
 * None of them report version details that are not already public, and none
 * report connection strings or dependency hostnames.
 *
 * On failure these still carry `data` (a caller wants to know *which* check
 * failed) but they also carry `message` and `code`, so a client that narrows on
 * `success === false` finds the same fields here as on every other error.
 */
export class HealthController {
  live = (_req: Request, res: Response): void => {
    res.status(200).json({
      success: true,
      data: { status: 'ok', uptime: Math.floor(process.uptime()) },
    });
  };

  ready = async (_req: Request, res: Response): Promise<void> => {
    const databaseReachable = await isDatabaseReachable();

    // 503 is the correct signal for "temporarily unable" — a load balancer
    // reacts to it, a monitoring system does not page for it the way it would
    // for a 500.
    res.status(databaseReachable ? 200 : 503).json({
      success: databaseReachable,
      ...(databaseReachable
        ? {}
        : { message: 'Service not ready', code: ERROR_CODES.SERVICE_UNAVAILABLE }),
      data: {
        status: databaseReachable ? 'ready' : 'not_ready',
        checks: { database: databaseReachable ? 'up' : 'down' },
      },
    });
  };

  health = async (_req: Request, res: Response): Promise<void> => {
    const databaseReachable = await isDatabaseReachable();

    res.status(databaseReachable ? 200 : 503).json({
      success: databaseReachable,
      ...(databaseReachable
        ? {}
        : { message: 'Service degraded', code: ERROR_CODES.SERVICE_UNAVAILABLE }),
      data: {
        status: databaseReachable ? 'healthy' : 'degraded',
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        environment: env.NODE_ENV,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        checks: { database: databaseReachable ? 'up' : 'down' },
      },
    });
  };
}
