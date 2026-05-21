import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../server.js';
import { generateAndPersistReport } from '../reports/service.js';

const ReportBody = z.object({
  fromSeq: z.coerce.number().int().min(1).optional(),
  toSeq: z.coerce.number().int().min(1).optional(),
  locale: z.string().optional(),
});

export async function registerReportRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  app.post(
    '/v1/reports',
    {
      preHandler: app.requireTenant,
      schema: {
        tags: ['reports'],
        summary: 'Generate a legal PDF report for a tenant + event range',
        body: {
          type: 'object',
          properties: {
            fromSeq: { type: 'integer', minimum: 1 },
            toSeq: { type: 'integer', minimum: 1 },
            locale: { type: 'string', enum: ['pt-BR', 'en-US', 'es-ES'] },
          },
        },
      },
    },
    async (req, reply) => {
      const parsed = ReportBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        reply.status(400);
        return { error: 'invalid_body', detail: parsed.error.flatten() };
      }
      const tenant = req.tenant!;
      const r = await generateAndPersistReport(deps.sql, deps.config, {
        tenant,
        fromSeq: parsed.data.fromSeq,
        toSeq: parsed.data.toSeq,
        locale: parsed.data.locale,
      });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="evidence-${r.reportId}.pdf"`);
      reply.header('X-Evidence-Report-Id', r.reportId);
      reply.header('X-Evidence-Report-Sha256', r.sha256);
      reply.header('X-Evidence-Report-Pages', String(r.pageCount));
      return reply.send(r.pdf);
    },
  );
}
