import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../server.js';
import {
  appendEvent,
  fetchChainRange,
  getEventById,
  listEvents,
  IdempotencyConflict,
} from '../events/repository.js';

const PostEventBody = z.object({
  source: z.string().min(1).max(128),
  externalId: z.string().min(1).max(256).optional(),
  payload: z.unknown().refine((v) => v !== null && v !== undefined, {
    message: 'payload is required',
  }),
});

const ListQuery = z.object({
  cursor: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const RangeQuery = z.object({
  fromSeq: z.coerce.number().int().min(1).optional(),
  toSeq: z.coerce.number().int().min(1).optional(),
});

export async function registerEventRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post('/v1/events', { preHandler: app.requireTenant }, async (req, reply) => {
    const body = PostEventBody.safeParse(req.body);
    if (!body.success) {
      reply.status(400);
      return { error: 'invalid_body', detail: body.error.flatten() };
    }
    const tenant = req.tenant!;
    try {
      const event = await appendEvent(deps.sql, {
        tenantId: tenant.id,
        source: body.data.source,
        externalId: body.data.externalId ?? null,
        payload: body.data.payload,
      });
      reply.status(201);
      return { event };
    } catch (err) {
      if (err instanceof IdempotencyConflict) {
        reply.status(200);
        return { event: err.existing, idempotent: true };
      }
      throw err;
    }
  });

  app.get('/v1/events', { preHandler: app.requireTenant }, async (req, reply) => {
    const q = ListQuery.safeParse(req.query);
    if (!q.success) {
      reply.status(400);
      return { error: 'invalid_query', detail: q.error.flatten() };
    }
    const tenant = req.tenant!;
    const { events, nextCursor } = await listEvents(deps.sql, {
      tenantId: tenant.id,
      cursor: q.data.cursor,
      limit: q.data.limit,
    });
    return { events, nextCursor };
  });

  app.get<{ Params: { id: string } }>(
    '/v1/events/:id',
    { preHandler: app.requireTenant },
    async (req, reply) => {
      const tenant = req.tenant!;
      const event = await getEventById(deps.sql, tenant.id, req.params.id);
      if (!event) {
        reply.status(404);
        return { error: 'not_found' };
      }
      return { event };
    },
  );

  app.get('/v1/chain', { preHandler: app.requireTenant }, async (req, reply) => {
    const q = RangeQuery.safeParse(req.query);
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
    return { events };
  });
}
