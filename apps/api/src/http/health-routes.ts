import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../server.js';

export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  app.get('/health', async () => {
    let db: 'ok' | 'down' = 'ok';
    try {
      await deps.sql`SELECT 1`;
    } catch {
      db = 'down';
    }
    return { status: db === 'ok' ? 'ok' : 'degraded', db };
  });
}
