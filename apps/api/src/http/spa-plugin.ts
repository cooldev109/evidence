import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../server.js';

// Path prefixes owned by the API — never served the SPA fallback.
// `/app/v1/*` is the end-user capture API; `/app` (no trailing segment) is the
// user web app and is allowed to fall through to the SPA.
const API_PREFIXES = ['/api', '/v1', '/admin/v1', '/app/v1', '/public', '/health', '/docs', '/assets'];

function isApiPath(url: string): boolean {
  const path = url.split('?')[0];
  return API_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}

/**
 * Serve the built React admin SPA at the site root (/) with BrowserRouter
 * support. Static files (index.html, /assets/*) are served directly; any other
 * GET that isn't an API path falls back to index.html so client-side routes
 * like /events survive a refresh or deep link. API prefixes still 404 as JSON.
 *
 * Returns true if the SPA was mounted (dist present), false otherwise.
 */
export async function registerSpa(app: FastifyInstance, deps: AppDeps): Promise<boolean> {
  const distPath =
    deps.config.ADMIN_DIST_PATH ||
    join(dirname(fileURLToPath(import.meta.url)), '../../../admin/dist');

  if (!existsSync(join(distPath, 'index.html'))) {
    app.log.warn(`admin SPA dist not found at ${distPath}; serving API metadata at /`);
    return false;
  }

  const indexHtml = readFileSync(join(distPath, 'index.html'), 'utf8');

  // wildcard:false serves only files that exist (index.html at /, /assets/*),
  // so missing paths fall through to the not-found handler below.
  await app.register(fastifyStatic, {
    root: distPath,
    prefix: '/',
    wildcard: false,
    decorateReply: false,
  });

  // SPA fallback: non-API GETs render index.html; everything else is a real 404.
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !isApiPath(req.url)) {
      reply.type('text/html').send(indexHtml);
      return;
    }
    reply.status(404).send({ error: 'not_found' });
  });

  return true;
}
