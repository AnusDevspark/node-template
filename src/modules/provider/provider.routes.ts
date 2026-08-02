import { Router, type RequestHandler } from 'express';
import { validate } from '@/middleware/validate.middleware';
import { PERMISSIONS } from '@/shared/constants/permissions.constant';
import type { ProviderController } from '@/modules/provider/provider.controller';
import {
  createProviderSchema,
  importProvidersSchema,
  listActiveProvidersQuerySchema,
  listProvidersQuerySchema,
  providerIdParamSchema,
  updateProviderSchema,
} from '@/modules/provider/provider.schema';

export interface ProviderRouteDependencies {
  controller: ProviderController;
  authenticate: RequestHandler;
  requirePermission: (...permissions: string[]) => RequestHandler;
}

export function createProviderRouter({
  controller,
  authenticate,
  requirePermission,
}: ProviderRouteDependencies): Router {
  const router = Router();

  router.use(authenticate);

  // Declared before '/:id' — otherwise Express matches "active" as an id and the
  // UUID validation rejects it with a confusing 400.
  router.get(
    '/active',
    requirePermission(PERMISSIONS.PROVIDER_VIEW),
    validate({ query: listActiveProvidersQuerySchema }),
    controller.getActiveProviders,
  );

  router.get(
    '/',
    requirePermission(PERMISSIONS.PROVIDER_VIEW),
    validate({ query: listProvidersQuerySchema }),
    controller.getProviders,
  );

  router.post(
    '/',
    requirePermission(PERMISSIONS.PROVIDER_CREATE),
    validate({ body: createProviderSchema }),
    controller.createProvider,
  );

  // Also before '/:id', for the same reason as '/active'.
  router.post(
    '/import',
    requirePermission(PERMISSIONS.PROVIDER_CREATE),
    validate({ body: importProvidersSchema }),
    controller.importProviders,
  );

  router.get(
    '/:id',
    requirePermission(PERMISSIONS.PROVIDER_VIEW),
    validate({ params: providerIdParamSchema }),
    controller.getProvider,
  );

  router.patch(
    '/:id',
    requirePermission(PERMISSIONS.PROVIDER_EDIT),
    validate({ params: providerIdParamSchema, body: updateProviderSchema }),
    controller.updateProvider,
  );

  router.delete(
    '/:id',
    requirePermission(PERMISSIONS.PROVIDER_DELETE),
    validate({ params: providerIdParamSchema }),
    controller.deleteProvider,
  );

  return router;
}
