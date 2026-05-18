import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../server.js';

export async function registerEvidenceRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/v1/events/:id/evidence',
    { preHandler: app.requireTenant },
    async (req, reply) => {
      const tenant = req.tenant!;
      const result = await deps.persistence.getEnvelopeForEvent(tenant.id, req.params.id);
      if (!result) {
        reply.status(404);
        return { error: 'not_found' };
      }
      // Return the envelope as the response body so verifiers can save it directly.
      reply.header('content-type', 'application/json');
      reply.header('x-evidence-sha256', result.meta.sha256);
      reply.header('x-evidence-object-key', result.meta.objectKey);
      reply.header('x-evidence-stored-at', result.meta.storedAt);
      return reply.send(result.envelope);
    },
  );
}
