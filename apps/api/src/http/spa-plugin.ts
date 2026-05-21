import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../server.js';

/**
 * Serve the built React admin SPA at the site root (/). The SPA is built with
 * base=/ and uses HashRouter, so all client routes live under /#/... and
 * resolve to the same index.html. API routes (/v1, /admin/v1, /public, /docs,
 * /health, /api) are explicit and take precedence over the static wildcard.
 *
 * Returns true if the SPA was mounted (dist present), false otherwise (local
 * dev without a build — the Vite dev server is used instead, and the API
 * exposes its metadata at /api).
 */
export async function registerSpa(app: FastifyInstance, deps: AppDeps): Promise<boolean> {
  const distPath =
    deps.config.ADMIN_DIST_PATH ||
    join(dirname(fileURLToPath(import.meta.url)), '../../../admin/dist');

  if (!existsSync(join(distPath, 'index.html'))) {
    app.log.warn(`admin SPA dist not found at ${distPath}; serving API metadata at /`);
    return false;
  }

  await app.register(fastifyStatic, {
    root: distPath,
    prefix: '/',
    decorateReply: false,
  });

  // Backward-compat: the panel used to live at /app.
  app.get('/app', async (_req, reply) => reply.redirect('/'));
  app.get('/app/', async (_req, reply) => reply.redirect('/'));

  return true;
}
