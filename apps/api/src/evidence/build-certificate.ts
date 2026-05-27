import { renderCertificate, type ReportResult } from '@evidence/pdf';
import type { AppDeps } from '../server.js';
import type { Capture } from '../userapp/repository.js';
import { listSignersByCapture } from '../userapp/signers.js';
import { getEventDetail } from '../events/repository.js';
import { getTenantSettings } from '../admin/repository.js';

/**
 * Assemble all the data needed to certify a single capture (chained event,
 * timestamp, optional media bytes for photo previews, ATA transcript/signers),
 * and render the PDF.
 */
export async function buildCertificate(
  deps: AppDeps,
  capture: Capture,
): Promise<ReportResult> {
  const tenant = await getTenantSettings(deps.sql, capture.tenantId);
  const detail = await getEventDetail(deps.sql, capture.tenantId, capture.eventId);
  if (!detail) throw new Error(`certificate: event ${capture.eventId} not found`);

  // Resolve the appUser email for "captured by" — fall back to the payload.
  let capturedByEmail = '—';
  try {
    const payload = detail.payload as { appUserEmail?: string } | undefined;
    if (payload && typeof payload.appUserEmail === 'string') {
      capturedByEmail = payload.appUserEmail;
    }
  } catch {
    /* ignore */
  }

  // Embed the photo for photo captures (kept under a reasonable size limit —
  // pdfkit will render image headers/bytes inline). Skip for non-photo kinds.
  let mediaBytes: Buffer | undefined;
  if (capture.kind === 'photo') {
    try {
      const got = await deps.persistence.getMedia(capture.objectKey);
      mediaBytes = got.body;
    } catch {
      // If we can't fetch the photo bytes the cert still renders without it.
    }
  }

  const signers =
    capture.kind === 'ata'
      ? (await listSignersByCapture(deps.sql, capture.tenantId, capture.id)).map((s) => ({
          name: s.name,
          email: s.email,
          signed: !!s.signedAt,
          signedAt: s.signedAt,
        }))
      : undefined;

  const ts = detail.timestamps[0]
    ? {
        provider: detail.timestamps[0].provider,
        jurisdiction: detail.timestamps[0].jurisdiction,
        issuedAt: detail.timestamps[0].issuedAt,
        digestHex: detail.timestamps[0].digestHex,
      }
    : null;

  return renderCertificate({
    captureId: capture.id,
    eventId: capture.eventId,
    kind: capture.kind,
    title: capture.title,
    capturedAt: capture.capturedAt,
    capturedByEmail,
    contentType: capture.contentType,
    sizeBytes: capture.sizeBytes,
    mediaSha256: capture.mediaSha256,
    geo: capture.geo,
    event: {
      seq: detail.seq,
      payloadHash: detail.payloadHash,
      prevHash: detail.prevHash,
      chainHash: detail.chainHash,
      createdAt: detail.createdAt,
    },
    timestamp: ts,
    mediaBytes,
    tenant: {
      id: capture.tenantId,
      slug: tenant?.slug ?? '',
      name: tenant?.name ?? '',
    },
    transcript: capture.transcript,
    signers,
    locale: tenant?.locale ?? 'pt-BR',
    verificationUrl: `${deps.config.PUBLIC_BASE_URL.replace(/\/$/, '')}/public/verify`,
    fileShareUrl: `${deps.config.PUBLIC_BASE_URL.replace(/\/$/, '')}/public/v1/share/${capture.shareToken}`,
    generatedAt: new Date().toISOString(),
  });
}
