import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { loadConfig, type AppConfig } from './config.js';
import { createDb, type PgClient } from './db/client.js';
import { registerAuth } from './http/auth-plugin.js';
import { registerEventRoutes } from './http/event-routes.js';
import { registerWebhookRoutes } from './http/webhook-routes.js';
import { registerVerifyRoutes } from './http/verify-routes.js';
import { registerHealthRoutes } from './http/health-routes.js';

export interface AppDeps {
  config: AppConfig;
  sql: PgClient;
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

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { sql } = createDb({ url: config.DATABASE_URL });
  const app = await buildServer({ config, sql });
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
