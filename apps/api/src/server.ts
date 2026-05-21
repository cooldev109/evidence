import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { loadConfig, type AppConfig } from './config.js';
import { createDb, type PgClient } from './db/client.js';
import { registerAuth } from './http/auth-plugin.js';
import { registerEventRoutes } from './http/event-routes.js';
import { registerWebhookRoutes } from './http/webhook-routes.js';
import { registerVerifyRoutes } from './http/verify-routes.js';
import { registerHealthRoutes } from './http/health-routes.js';
import { registerEvidenceRoutes } from './http/evidence-routes.js';
import { registerReportRoutes } from './http/report-routes.js';
import { registerPublicRoutes } from './http/public-routes.js';
import { registerAdminRoutes } from './http/admin-routes.js';
import { registerRootRoute } from './http/root-route.js';
import { registerSpa } from './http/spa-plugin.js';
import { buildStore, buildTSARegistry } from './evidence/bootstrap.js';
import { EvidencePersistenceService } from './evidence/persistence-service.js';

export interface AppDeps {
  config: AppConfig;
  sql: PgClient;
  persistence: EvidencePersistenceService;
}

export async function buildServer(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: deps.config.LOG_LEVEL },
    genReqId: () =>
      `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
  });

  await app.register(sensible);

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'EVIDENCE API',
        version: '0.3.0',
        description:
          'Digital chain-of-custody API. Authenticated endpoints (v1/*) require an `Authorization: Bearer evk_...` header. Public endpoints under /public/* are unauthenticated and rate-limited.',
      },
      servers: [{ url: deps.config.PUBLIC_BASE_URL, description: 'Production' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'evk_...' },
        },
      },
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: false },
    staticCSP: true,
  });

  await registerRootRoute(app, deps);
  await registerHealthRoutes(app, deps);
  await registerAuth(app, deps);
  await registerEventRoutes(app, deps);
  await registerWebhookRoutes(app, deps);
  await registerVerifyRoutes(app, deps);
  await registerEvidenceRoutes(app, deps);
  await registerReportRoutes(app, deps);
  await registerPublicRoutes(app, deps);
  await registerAdminRoutes(app, deps);
  await registerSpa(app, deps);

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { sql } = createDb({ url: config.DATABASE_URL });
  const store = buildStore(config);
  const tsaRegistry = buildTSARegistry(config);
  const persistence = new EvidencePersistenceService({ sql, store, tsaRegistry });
  const app = await buildServer({ config, sql, persistence });
  try {
    await app.listen({ host: config.API_HOST, port: config.API_PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
