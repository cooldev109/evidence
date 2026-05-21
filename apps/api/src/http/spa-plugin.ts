import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../server.js';

/**
 * Serve the built React admin SPA at /app. The SPA is built with base=/app/,
 * so its asset URLs already point at /app/assets/*. It uses HashRouter, so all
 * client routes live under /app/#/... and resolve to the same index.html.
 *
 * In local dev (no dist built) this is a no-op; the admin runs from the Vite
 * dev server instead.
 */
export async function registerSpa(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const distPath =
    deps.config.ADMIN_DIST_PATH ||
    join(dirname(fileURLToPath(import.meta.url)), '../../../admin/dist');

  if (!existsSync(join(distPath, 'index.html'))) {
    app.log.warn(`admin SPA dist not found at ${distPath}; /app not served`);
    return;
  }

  await app.register(fastifyStatic, {
    root: distPath,
    prefix: '/app/',
    decorateReply: false,
  });

  // /app -> /app/
  app.get('/app', async (_req, reply) => reply.redirect('/app/'));
}
