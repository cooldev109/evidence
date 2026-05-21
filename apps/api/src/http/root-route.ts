import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../server.js';

export async function registerRootRoute(app: FastifyInstance, _deps: AppDeps): Promise<void> {
  app.get(
    '/',
    {
      schema: {
        tags: ['meta'],
        summary: 'API metadata',
        description: 'A friendly JSON landing response so the root URL is not a bare 404.',
      },
    },
    async () => ({
      name: 'EVIDENCE API',
      version: '0.3.0',
      status: 'ok',
      milestones: { m1: 'complete', m2: 'complete', m3: 'complete' },
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
        docs: '/docs',
      },
      source: 'https://github.com/cooldev109/evidence',
    }),
  );
}
