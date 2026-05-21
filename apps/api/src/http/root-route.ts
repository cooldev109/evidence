import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../server.js';

const METADATA = {
  name: 'EVIDENCE API',
  version: '0.4.0',
  status: 'ok',
  milestones: { m1: 'complete', m2: 'complete', m3: 'complete', m4: 'complete' },
  endpoints: {
    health: '/health',
    events: '/v1/events',
    chain: '/v1/chain',
    verify: '/v1/verify',
    evidence: '/v1/events/:id/evidence',
    reports: '/v1/reports',
    public_evidence: '/public/v1/evidence/:id',
    public_verify: '/public/v1/verify',
    public_report_verify: '/public/v1/reports/:id/verify',
    public_verify_page: '/public/verify?report=:id',
    admin_panel: '/',
    docs: '/docs',
  },
  source: 'https://github.com/cooldev109/evidence',
};

/**
 * API metadata. Always available at /api. When the admin SPA is not mounted at
 * the root (local dev without a build), this is also registered at / so the
 * root isn't a bare 404.
 */
export async function registerMetaRoute(
  app: FastifyInstance,
  _deps: AppDeps,
  alsoAtRoot: boolean,
): Promise<void> {
  app.get('/api', { schema: { tags: ['meta'], summary: 'API metadata' } }, async () => METADATA);
  if (alsoAtRoot) {
    app.get('/', { schema: { tags: ['meta'], summary: 'API metadata' } }, async () => METADATA);
  }
}
