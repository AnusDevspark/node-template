import { Router } from 'express';
import { HealthController } from '@/modules/health/health.controller';

/**
 * Mounted at the root (`/health`), not under `/api/v1`.
 *
 * Probes should not have to track API versioning, and the path must stay stable
 * across versions because it is configured in infrastructure — a Kubernetes
 * manifest or load balancer config — that is deployed separately from this code.
 */
export function createHealthRouter(): Router {
  const router = Router();
  const controller = new HealthController();

  router.get('/', controller.health);
  router.get('/live', controller.live);
  router.get('/ready', controller.ready);

  return router;
}
