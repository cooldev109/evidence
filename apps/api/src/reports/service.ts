import { randomUUID } from 'node:crypto';
import { renderReport, resolveLocale, type ReportInput } from '@evidence/pdf';
import { verifyChain } from '@evidence/core';
import { localeToJurisdiction } from '@evidence/tsa';
import type { AppConfig } from '../config.js';
import type { PgClient } from '../db/client.js';
import { fetchChainRange } from '../events/repository.js';
import { withTenant } from '../db/tenant-context.js';

interface TimestampRow {
  event_seq: string | number;
  provider: string;
  jurisdiction: string;
  issued_at: string;
  digest_hex: string;
}

export interface GenerateReportInput {
  tenant: { id: string; slug: string; name: string; locale: string };
  fromSeq?: number;
  toSeq?: number;
  locale?: string;
}

export interface GeneratedReport {
  reportId: string;
  pdf: Buffer;
  sha256: string;
  pageCount: number;
}

/**
 * Generate the legal PDF for a tenant + event range and persist a reports row
 * so the QR / short URL resolves to a verification of this exact document.
 * Shared by the API-key route (/v1/reports) and the admin route.
 */
export async function generateAndPersistReport(
  sql: PgClient,
  config: AppConfig,
  input: GenerateReportInput,
): Promise<GeneratedReport> {
  const locale = resolveLocale(input.locale ?? input.tenant.locale);
  const events = await fetchChainRange(sql, {
    tenantId: input.tenant.id,
    fromSeq: input.fromSeq,
    toSeq: input.toSeq,
  });

  const tsRows = await withTenant(sql, input.tenant.id, async (tx) => {
    return tx<TimestampRow[]>`
      SELECT e.seq AS event_seq, t.provider, t.jurisdiction, t.issued_at, t.digest_hex
      FROM event_timestamps t
      JOIN events e ON e.id = t.event_id
      WHERE t.tenant_id = ${input.tenant.id}
      ORDER BY e.seq ASC
    `;
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
    input.tenant.id,
  );

  const generatedAt = new Date().toISOString();
  const reportId = randomUUID();
  const verificationUrl = `${config.PUBLIC_BASE_URL}/public/verify`;
  const fromSeq = events.length ? events[0].seq : 0;
  const toSeq = events.length ? events[events.length - 1].seq : 0;

  const result = await renderReport({
    reportId,
    generatedAt,
    tenant: { id: input.tenant.id, slug: input.tenant.slug, name: input.tenant.name },
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

  await withTenant(sql, input.tenant.id, async (tx) => {
    await tx`
      INSERT INTO reports (id, tenant_id, from_seq, to_seq, locale, pdf_sha256, page_count, created_at)
      VALUES (${reportId}, ${input.tenant.id}, ${fromSeq}, ${toSeq}, ${locale}, ${result.sha256}, ${result.pageCount}, ${generatedAt})
    `;
  });

  return { reportId, pdf: result.pdf, sha256: result.sha256, pageCount: result.pageCount };
}
