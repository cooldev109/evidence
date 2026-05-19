import { describe, expect, it } from 'vitest';
import { renderReport, type ReportInput } from './report.js';
import { sha256Hex } from '@evidence/core';

const FIXED_DATE = '2026-05-19T12:00:00.000Z';

function baseInput(locale: ReportInput['locale']): ReportInput {
  return {
    reportId: 'demo-2026051912000000',
    generatedAt: FIXED_DATE,
    tenant: { id: '11111111-2222-3333-4444-555555555555', slug: 'acme', name: 'Acme' },
    locale,
    jurisdiction: 'BR',
    events: [
      {
        seq: 1,
        source: 'app',
        createdAt: '2026-05-19T11:00:00.000Z',
        payloadHash: 'a'.repeat(64),
        prevHash: '0'.repeat(64),
        chainHash: 'b'.repeat(64),
      },
      {
        seq: 2,
        source: 'app',
        createdAt: '2026-05-19T11:30:00.000Z',
        payloadHash: 'c'.repeat(64),
        prevHash: 'b'.repeat(64),
        chainHash: 'd'.repeat(64),
      },
    ],
    timestampsByEventId: {
      1: [
        {
          provider: 'mock',
          issuedAt: '2026-05-19T11:00:01.000Z',
          digestHex: 'a'.repeat(64),
          jurisdiction: 'BR',
        },
      ],
      2: [
        {
          provider: 'mock',
          issuedAt: '2026-05-19T11:30:01.000Z',
          digestHex: 'c'.repeat(64),
          jurisdiction: 'BR',
        },
      ],
    },
    chainStatus: { ok: true, verified: 2 },
    verificationUrl: 'http://docas.ai/public/verify',
  };
}

describe('renderReport', () => {
  it('produces a PDF buffer starting with %PDF-', async () => {
    const r = await renderReport(baseInput('pt-BR'));
    expect(r.pdf.slice(0, 5).toString('ascii')).toBe('%PDF-');
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.pageCount).toBeGreaterThanOrEqual(2);
  });

  it.each(['pt-BR', 'en-US', 'es-ES'] as const)('renders in %s', async (locale) => {
    const r = await renderReport(baseInput(locale));
    expect(r.pdf.length).toBeGreaterThan(2000);
    expect(r.sha256).toBe(sha256Hex(r.pdf));
  });

  it('different locales produce different PDFs', async () => {
    const pt = await renderReport(baseInput('pt-BR'));
    const en = await renderReport(baseInput('en-US'));
    const es = await renderReport(baseInput('es-ES'));
    expect(pt.sha256).not.toBe(en.sha256);
    expect(pt.sha256).not.toBe(es.sha256);
    expect(en.sha256).not.toBe(es.sha256);
  });

  it('tampered chain status produces visibly different output', async () => {
    const ok = await renderReport(baseInput('pt-BR'));
    const tampered = await renderReport({
      ...baseInput('pt-BR'),
      chainStatus: { ok: false, reason: 'hash-mismatch', atSeq: 2 },
    });
    expect(ok.sha256).not.toBe(tampered.sha256);
  });
});
