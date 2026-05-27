import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { Verifier } from '@evidence/verify';
import { MockTSAProvider, FreeTSAProvider } from '@evidence/tsa';
import { verifyChain } from '@evidence/core';
import type { AppDeps } from '../server.js';
import { withTenant } from '../db/tenant-context.js';
import {
  fetchChainForVerification,
  appendEvent,
  getEventById,
} from '../events/repository.js';
import { getCapture, findCaptureByShareToken } from '../userapp/repository.js';
import { getTenantSettings } from '../admin/repository.js';
import { findSignerByToken, markSignerSigned } from '../userapp/signers.js';
import { computeRetainUntil } from '../evidence/bootstrap.js';

const VerifyBody = z.object({
  envelope: z
    .union([z.string(), z.record(z.unknown())])
    .describe('A canonical evidence envelope (JSON string or object)'),
});

const SignBody = z.object({ name: z.string().max(200).optional() });

interface EvidenceRow {
  tenant_id: string;
  object_key: string;
  version_id: string | null;
  sha256: string;
}

interface ReportRow {
  id: string;
  tenant_id: string;
  from_seq: string | number;
  to_seq: string | number;
  locale: string;
  pdf_sha256: string;
  page_count: number;
  created_at: string;
}

export interface ReportVerification {
  report: {
    id: string;
    fromSeq: number;
    toSeq: number;
    locale: string;
    pdfSha256: string;
    pageCount: number;
    createdAt: string;
  };
  chain: ReturnType<typeof verifyChain>;
  ok: boolean;
}

/**
 * Re-verify the event range a persisted report covers. Reads the report row,
 * fetches the events (with payloads) and runs the full chain verification so
 * the result reflects payload tampering too. Returns null if no such report.
 */
async function verifyReportById(
  deps: AppDeps,
  reportId: string,
): Promise<ReportVerification | null> {
  const rows = await deps.sql<ReportRow[]>`
    SELECT id, tenant_id, from_seq, to_seq, locale, pdf_sha256, page_count, created_at
    FROM reports WHERE id = ${reportId} LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  const fromSeq = Number(r.from_seq);
  const toSeq = Number(r.to_seq);
  const events = await fetchChainForVerification(deps.sql, {
    tenantId: r.tenant_id,
    fromSeq,
    toSeq,
  });
  const chain = verifyChain(
    events.map((e) => ({
      seq: e.seq,
      tenantId: e.tenantId,
      payloadHash: e.payloadHash,
      prevHash: e.prevHash,
      chainHash: e.chainHash,
      createdAt: e.createdAt,
      payload: e.payload,
    })),
    r.tenant_id,
  );
  return {
    report: {
      id: r.id,
      fromSeq,
      toSeq,
      locale: r.locale,
      pdfSha256: r.pdf_sha256,
      pageCount: r.page_count,
      createdAt: r.created_at,
    },
    chain,
    ok: chain.ok,
  };
}

export async function registerPublicRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  // Public endpoints are unauthenticated but rate-limited per IP to protect
  // against scraping / DoS. The rate-limit plugin is registered inside an
  // encapsulated scope so it doesn't affect authenticated endpoints.
  await app.register(async (scope) => {
    await scope.register(rateLimit, {
      max: deps.config.PUBLIC_RATE_LIMIT_MAX,
      timeWindow: deps.config.PUBLIC_RATE_LIMIT_WINDOW,
      // The rate-limit response uses Fastify's built-in error envelope.
    });

    scope.get<{ Params: { id: string } }>(
      '/public/v1/evidence/:id',
      {
        schema: {
          tags: ['public'],
          summary: 'Fetch the canonical evidence envelope for a given event id',
          description:
            'No authentication required. The envelope contains everything a third party needs to independently verify the event (canonical event JSON, payload hash, chain hash, TSA tokens).',
          params: {
            type: 'object',
            properties: { id: { type: 'string', format: 'uuid' } },
            required: ['id'],
          },
        },
      },
      async (req, reply) => {
        const id = req.params.id;
        const rows = await deps.sql<EvidenceRow[]>`
          SELECT tenant_id, object_key, version_id, sha256
          FROM evidence_objects
          WHERE event_id = ${id}
          LIMIT 1
        `;
        if (rows.length === 0) {
          reply.status(404);
          return { error: 'not_found' };
        }
        const row = rows[0];
        // Read envelope via tenant scope so RLS still applies.
        const envelope = await withTenant(deps.sql, row.tenant_id, async () => {
          return deps.persistence.getEnvelopeForEvent(row.tenant_id, id);
        });
        if (!envelope) {
          reply.status(404);
          return { error: 'not_found' };
        }
        reply.header('content-type', 'application/json');
        reply.header('x-evidence-sha256', envelope.meta.sha256);
        return reply.send(envelope.envelope);
      },
    );

    scope.post(
      '/public/v1/verify',
      {
        schema: {
          tags: ['public'],
          summary: 'Independently verify a canonical evidence envelope',
          description:
            'Accepts a canonical evidence envelope (JSON) and returns a structured pass/fail report. Recomputes the payload hash, the chain hash, and verifies each TSA token using the registered providers. No authentication required.',
          body: {
            type: 'object',
            properties: { envelope: {} },
            required: ['envelope'],
          },
        },
      },
      async (req, reply) => {
        const parsed = VerifyBody.safeParse(req.body);
        if (!parsed.success) {
          reply.status(400);
          return { error: 'invalid_body', detail: parsed.error.flatten() };
        }
        const verifier = new Verifier({
          tsaProviders: [new MockTSAProvider(), new FreeTSAProvider()],
        });
        const bodyText =
          typeof parsed.data.envelope === 'string'
            ? parsed.data.envelope
            : JSON.stringify(parsed.data.envelope);
        try {
          const report = await verifier.verifyEnvelope(bodyText);
          return report;
        } catch (err) {
          reply.status(400);
          return {
            error: 'malformed_envelope',
            detail: err instanceof Error ? err.message : String(err),
          };
        }
      },
    );

    scope.get<{ Params: { id: string } }>(
      '/public/v1/reports/:id/verify',
      {
        schema: {
          tags: ['public'],
          summary: 'Re-verify the event range a legal report (PDF) covers',
          description:
            'No authentication required. Returns the report metadata (including the PDF SHA-256 so a holder can confirm their file) and a full chain verification of every event the report covers.',
          params: {
            type: 'object',
            properties: { id: { type: 'string', format: 'uuid' } },
            required: ['id'],
          },
        },
      },
      async (req, reply) => {
        const result = await verifyReportById(deps, req.params.id);
        if (!result) {
          reply.status(404);
          return { error: 'not_found' };
        }
        return result;
      },
    );

    // ---- Public media share (token-gated, no auth) ----
    // The PDF certificate of a capture embeds /public/v1/share/<token> as a
    // clickable link + QR code, so a recipient who only has the certificate
    // (e.g. a lawyer) can fetch the original media and verify it against the
    // SHA-256 printed in the PDF. The token is 24 random bytes — possession
    // of the certificate = possession of the share token.
    scope.get<{ Params: { token: string } }>(
      '/public/v1/share/:token',
      { schema: { tags: ['public'], summary: 'Fetch the original media file by share token' } },
      async (req, reply) => {
        const capture = await findCaptureByShareToken(deps.sql, req.params.token);
        if (!capture) {
          reply.status(404);
          return { error: 'not_found' };
        }
        const { body, contentType } = await deps.persistence.getMedia(capture.objectKey);
        const extMap: Record<string, string> = {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/webp': 'webp',
          'image/heic': 'heic',
          'video/mp4': 'mp4',
          'video/webm': 'webm',
          'video/quicktime': 'mov',
          'audio/mp4': 'm4a',
          'audio/webm': 'webm',
          'audio/wav': 'wav',
          'audio/mpeg': 'mp3',
          'audio/ogg': 'ogg',
        };
        const baseType = (capture.contentType.split(';')[0] || '').trim().toLowerCase();
        const ext = extMap[baseType] ?? 'bin';
        reply.header('Content-Type', contentType ?? capture.contentType);
        reply.header('X-Evidence-Sha256', capture.mediaSha256);
        reply.header(
          'Content-Disposition',
          `attachment; filename="evidence-${capture.id}.${ext}"`,
        );
        return reply.send(body);
      },
    );

    // ---- ATA click-to-sign (public, no auth) ----
    // A participant opens /assinar/:token, reviews the ATA, and signs. Signing
    // appends its own chained + RFC-3161 event, so each signature is
    // independently tamper-evident and time-anchored.
    scope.get<{ Params: { token: string } }>(
      '/public/v1/ata/sign/:token',
      { schema: { tags: ['public'], summary: 'Fetch an ATA for click-to-sign by token' } },
      async (req, reply) => {
        const signer = await findSignerByToken(deps.sql, req.params.token);
        if (!signer) {
          reply.status(404);
          return { error: 'not_found' };
        }
        const capture = await getCapture(deps.sql, signer.tenantId, signer.captureId);
        const tenant = await getTenantSettings(deps.sql, signer.tenantId);
        return {
          signed: !!signer.signedAt,
          signer: { name: signer.name, email: signer.email, signedAt: signer.signedAt },
          ata: capture
            ? {
                title: capture.title,
                transcript: capture.transcript,
                capturedAt: capture.capturedAt,
                geo: capture.geo,
                organization: tenant?.name ?? null,
              }
            : null,
        };
      },
    );

    scope.post<{ Params: { token: string } }>(
      '/public/v1/ata/sign/:token',
      {
        schema: {
          tags: ['public'],
          summary: 'Record a click-to-sign signature for an ATA',
          body: { type: 'object', properties: { name: { type: 'string' } } },
        },
      },
      async (req, reply) => {
        const parsed = SignBody.safeParse(req.body ?? {});
        if (!parsed.success) {
          reply.status(400);
          return { error: 'invalid_body' };
        }
        const signer = await findSignerByToken(deps.sql, req.params.token);
        if (!signer) {
          reply.status(404);
          return { error: 'not_found' };
        }
        // Idempotent: a second submit just returns the existing signature.
        if (signer.signedAt) {
          return { signed: true, signedAt: signer.signedAt, alreadySigned: true };
        }

        const ataEvent = await getEventById(deps.sql, signer.tenantId, signer.eventId);
        if (!ataEvent) {
          reply.status(404);
          return { error: 'ata_not_found' };
        }
        const tenant = await getTenantSettings(deps.sql, signer.tenantId);
        const signedAt = new Date().toISOString();
        const signerName = (parsed.data.name ?? signer.name ?? '').slice(0, 200);

        // Seal the signature as its own chained event bound to the ATA's hash.
        const payload = {
          type: 'ata-signature',
          method: 'click-to-sign',
          captureId: signer.captureId,
          ataEventId: signer.eventId,
          ataPayloadHash: ataEvent.payloadHash,
          signerId: signer.id,
          signerName,
          signerEmail: signer.email,
          signedAt,
          ip: req.ip,
          userAgent: String(req.headers['user-agent'] ?? '').slice(0, 400),
        };
        const sigEvent = await appendEvent(deps.sql, {
          tenantId: signer.tenantId,
          source: 'app:ata-signature',
          payload,
        });
        await deps.persistence.persist({
          tenantId: signer.tenantId,
          tenantLocale: tenant?.locale ?? 'pt-BR',
          event: sigEvent,
          payload,
          retainMode: deps.config.RETAIN_MODE,
          retainUntilIso:
            deps.config.RETAIN_MODE === 'none' ? null : computeRetainUntil(deps.config.RETAIN_YEARS),
          kmsKeyId: deps.config.STORAGE_KMS_KEY_ID,
        });
        await markSignerSigned(deps.sql, signer.tenantId, signer.id, sigEvent.id, signedAt);

        return { signed: true, signedAt, signatureEventId: sigEvent.id };
      },
    );

    // Minimal HTML verification page so a verifier landing from a QR code
    // sees something human-readable rather than raw JSON. Handles either
    // ?report=<id> (the PDF's QR target) or ?event=<id>.
    scope.get<{ Querystring: { report?: string; event?: string } }>(
      '/public/verify',
      {
        schema: {
          tags: ['public'],
          summary: 'Human-readable verification landing page (HTML)',
        },
      },
      async (req, reply) => {
        const reportId = req.query.report ?? null;
        if (reportId) {
          const result = await verifyReportById(deps, reportId);
          reply.type('text/html');
          if (!result) {
            reply.status(404);
            return reply.send(renderResult({ ok: false, message: 'Report not found.' }));
          }
          return reply.send(
            renderResult({
              ok: result.ok,
              message: `Report ${result.report.id} — events ${result.report.fromSeq}–${result.report.toSeq}, ${result.report.locale}. PDF SHA-256: ${result.report.pdfSha256}.${result.ok ? '' : ' Chain check: ' + JSON.stringify(result.chain)}`,
            }),
          );
        }
        const eventId = req.query.event ?? null;
        if (!eventId) {
          reply.type('text/html');
          return reply.send(renderLanding(deps.config.PUBLIC_BASE_URL));
        }
        const rows = await deps.sql<EvidenceRow[]>`
          SELECT tenant_id, object_key, version_id, sha256
          FROM evidence_objects
          WHERE event_id = ${eventId}
          LIMIT 1
        `;
        if (rows.length === 0) {
          reply.type('text/html').status(404);
          return reply.send(renderResult({ ok: false, message: 'Event not found.' }));
        }
        const envelope = await withTenant(deps.sql, rows[0].tenant_id, async () => {
          return deps.persistence.getEnvelopeForEvent(rows[0].tenant_id, eventId);
        });
        if (!envelope) {
          reply.type('text/html').status(404);
          return reply.send(renderResult({ ok: false, message: 'Envelope not found.' }));
        }
        const verifier = new Verifier({
          tsaProviders: [new MockTSAProvider(), new FreeTSAProvider()],
        });
        const report = await verifier.verifyEnvelope(envelope.envelope);
        reply.type('text/html');
        return reply.send(renderResult({ ok: report.ok, eventId, sha: report.envelopeSha256 }));
      },
    );
  });
}

function renderLanding(publicBase: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>EVIDENCE — Public Verification</title>
<style>
body{font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:680px;margin:48px auto;padding:0 16px;color:#111}
h1{font-size:22px;margin:0 0 8px}
.muted{color:#666}
code{background:#f4f4f4;padding:2px 6px;border-radius:4px}
</style></head><body>
<h1>EVIDENCE — Public Verification</h1>
<p class="muted">Open <code>${publicBase}/public/verify?event=&lt;eventId&gt;</code> to verify a specific event, or POST a canonical evidence envelope to <code>${publicBase}/public/v1/verify</code>.</p>
<p>This page is reached automatically when scanning the QR code printed on an EVIDENCE legal report.</p>
</body></html>`;
}

interface ResultRender {
  ok: boolean;
  eventId?: string;
  sha?: string;
  message?: string;
}

function renderResult(r: ResultRender): string {
  const color = r.ok ? '#0a6b2a' : '#a31515';
  const banner = r.ok ? '✓ VERIFIED' : '✗ NOT VERIFIED';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>EVIDENCE — Verification result</title>
<style>
body{font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:680px;margin:48px auto;padding:0 16px;color:#111}
h1{font-size:28px;margin:0 0 16px;color:${color}}
.muted{color:#666}
code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-size:12px;word-break:break-all}
</style></head><body>
<h1>${banner}</h1>
${r.eventId ? `<p>Event ID: <code>${r.eventId}</code></p>` : ''}
${r.sha ? `<p>Envelope SHA-256: <code>${r.sha}</code></p>` : ''}
${r.message ? `<p>${r.message}</p>` : ''}
<p class="muted">Generated by EVIDENCE / public verification.</p>
</body></html>`;
}
