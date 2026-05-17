import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyChain } from '@evidence/core';
import type { AppDeps } from '../server.js';
import { fetchChainRange } from '../events/repository.js';

const VerifyQuery = z.object({
  fromSeq: z.coerce.number().int().min(1).optional(),
  toSeq: z.coerce.number().int().min(1).optional(),
});

export async function registerVerifyRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  app.get('/v1/verify', { preHandler: app.requireTenant }, async (req, reply) => {
    const q = VerifyQuery.safeParse(req.query);
    if (!q.success) {
      reply.status(400);
      return { error: 'invalid_query', detail: q.error.flatten() };
    }
    const tenant = req.tenant!;
    const events = await fetchChainRange(deps.sql, {
      tenantId: tenant.id,
      fromSeq: q.data.fromSeq,
      toSeq: q.data.toSeq,
    });
    const result = verifyChain(
      events.map((e) => ({
        seq: e.seq,
        tenantId: e.tenantId,
        payloadHash: e.payloadHash,
        prevHash: e.prevHash,
        chainHash: e.chainHash,
        createdAt: e.createdAt,
      })),
      tenant.id,
    );
    return { result, range: { fromSeq: q.data.fromSeq ?? 1, toSeq: q.data.toSeq ?? null } };
  });
}
