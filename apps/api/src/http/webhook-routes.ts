import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../server.js';
import { appendEvent, IdempotencyConflict } from '../events/repository.js';
import { computeRetainUntil } from '../evidence/bootstrap.js';

const WebhookBody = z.object({
  externalId: z.string().min(1).max(256),
  payload: z.unknown(),
});

function verifySignature(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  app.post<{ Params: { source: string } }>(
    '/v1/webhooks/:source',
    { preHandler: app.requireTenant },
    async (req, reply) => {
      const tenant = req.tenant!;
      const rawBody = JSON.stringify(req.body ?? {});
      const signature = req.headers['x-evidence-signature'];
      if (
        !verifySignature(
          deps.config.WEBHOOK_HMAC_SECRET,
          rawBody,
          Array.isArray(signature) ? signature[0] : signature,
        )
      ) {
        reply.status(401);
        return { error: 'invalid_signature' };
      }
      const parsed = WebhookBody.safeParse(req.body);
      if (!parsed.success) {
        reply.status(400);
        return { error: 'invalid_body', detail: parsed.error.flatten() };
      }
      try {
        const event = await appendEvent(deps.sql, {
          tenantId: tenant.id,
          source: req.params.source,
          externalId: parsed.data.externalId,
          payload: parsed.data.payload,
        });
        const persisted = await deps.persistence.persist({
          tenantId: tenant.id,
          tenantLocale: tenant.locale,
          event,
          payload: parsed.data.payload,
          retainMode: deps.config.RETAIN_MODE,
          retainUntilIso:
            deps.config.RETAIN_MODE === 'none'
              ? null
              : computeRetainUntil(deps.config.RETAIN_YEARS),
          kmsKeyId: deps.config.STORAGE_KMS_KEY_ID,
        });
        reply.status(201);
        return { event, evidence: persisted };
      } catch (err) {
        if (err instanceof IdempotencyConflict) {
          reply.status(200);
          return { event: err.existing, idempotent: true };
        }
        throw err;
      }
    },
  );
}
