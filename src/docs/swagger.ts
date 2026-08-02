import type { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { logger } from '@/config/logger';
import { buildOpenApiDocument } from '@/docs/openapi';

/**
 * Mounts Swagger UI and the raw spec.
 *
 * The document is built once at startup rather than per request — it is derived
 * from static schemas, so rebuilding it on every page load is pure waste.
 *
 * `/api/docs.json` is exposed alongside the UI because that is what client
 * generators, Postman and contract tests consume.
 *
 * In production, consider setting SWAGGER_ENABLED=false for a private API: the
 * document is an exact map of your attack surface, including which permissions
 * guard which endpoint.
 */
export function mountSwagger(app: Express, path: string): void {
  const document = buildOpenApiDocument();

  app.get(`${path}.json`, (_req, res) => {
    res.json(document);
  });

  app.use(
    path,
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: 'API Documentation',
      swaggerOptions: {
        // Keep the bearer token across page reloads so testing endpoints in the
        // UI does not mean re-authorising constantly.
        persistAuthorization: true,
        docExpansion: 'list',
        tagsSorter: 'alpha',
      },
    }),
  );

  logger.info({ path }, 'API documentation mounted');
}
