import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { renderReport, resolveLocale, type ReportInput } from '@evidence/pdf';
import { verifyChain } from '@evidence/core';
import { localeToJurisdiction } from '@evidence/tsa';
import type { AppDeps } from '../server.js';
import { fetchChainRange } from '../events/repository.js';
import { withTenant } from '../db/tenant-context.js';

const ReportBody = z.object({
  fromSeq: z.coerce.number().int().min(1).optional(),
  toSeq: z.coerce.number().int().min(1).optional(),
  locale: z.string().optional(),
});

interface TimestampRow {
  event_seq: string | number;
  provider: string;
  jurisdiction: string;
  issued_at: string;
  digest_hex: string;
}

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
      const locale = resolveLocale(parsed.data.locale ?? tenant.locale);
      const events = await fetchChainRange(deps.sql, {
        tenantId: tenant.id,
        fromSeq: parsed.data.fromSeq,
        toSeq: parsed.data.toSeq,
      });

      const tsRows = await withTenant(deps.sql, tenant.id, async (tx) => {
        const rows = await tx<TimestampRow[]>`
          SELECT e.seq AS event_seq, t.provider, t.jurisdiction, t.issued_at, t.digest_hex
          FROM event_timestamps t
          JOIN events e ON e.id = t.event_id
          WHERE t.tenant_id = ${tenant.id}
          ORDER BY e.seq ASC
        `;
        return rows;
      });

      const timestampsByEventId: ReportInput['timestampsByEventId'] = {};
      for (const r of tsRows) {
        const seq = Number(r.event_seq);
        timestampsByEventId[seq] = timestampsByEventId[seq] ?? [];
        timestampsByEventId[seq].push({
          provider: r.provider,
          issuedAt: r.issued_at,
          digestHex: r.digest_hex,
          jurisdiction: r.jurisdiction,
        });
      }

      const chainResult = verifyChain(
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

      const generatedAt = new Date().toISOString();
      const reportId = `${tenant.id.slice(0, 8)}-${generatedAt.replace(/[:.]/g, '').slice(0, 15)}`;
      const verificationUrl = `${deps.config.PUBLIC_BASE_URL}/public/verify`;

      const result = await renderReport({
        reportId,
        generatedAt,
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
        locale,
        jurisdiction: localeToJurisdiction(locale),
        events: events.map((e) => ({
          seq: e.seq,
          source: e.source,
          createdAt: e.createdAt,
          payloadHash: e.payloadHash,
          prevHash: e.prevHash,
          chainHash: e.chainHash,
        })),
        timestampsByEventId,
        chainStatus: chainResult.ok
          ? { ok: true, verified: chainResult.verified }
          : { ok: false, reason: chainResult.reason, atSeq: chainResult.atSeq },
        verificationUrl,
      });

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="evidence-${reportId}.pdf"`);
      reply.header('X-Evidence-Report-Id', reportId);
      reply.header('X-Evidence-Report-Sha256', result.sha256);
      reply.header('X-Evidence-Report-Pages', String(result.pageCount));
      return reply.send(result.pdf);
    },
  );
}
