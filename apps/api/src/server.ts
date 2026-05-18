import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { loadConfig, type AppConfig } from './config.js';
import { createDb, type PgClient } from './db/client.js';
import { registerAuth } from './http/auth-plugin.js';
import { registerEventRoutes } from './http/event-routes.js';
import { registerWebhookRoutes } from './http/webhook-routes.js';
import { registerVerifyRoutes } from './http/verify-routes.js';
import { registerHealthRoutes } from './http/health-routes.js';
import { registerEvidenceRoutes } from './http/evidence-routes.js';
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
  await registerHealthRoutes(app, deps);
  await registerAuth(app, deps);
  await registerEventRoutes(app, deps);
  await registerWebhookRoutes(app, deps);
  await registerVerifyRoutes(app, deps);
  await registerEvidenceRoutes(app, deps);

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
