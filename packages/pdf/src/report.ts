import { Buffer } from 'node:buffer';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { sha256Hex } from '@evidence/core';
import { messages, resolveLocale, type Locale } from './i18n.js';

export interface ReportEvent {
  seq: number;
  source: string;
  createdAt: string;
  payloadHash: string;
  prevHash: string;
  chainHash: string;
}

export interface ReportTimestamp {
  provider: string;
  issuedAt: string;
  digestHex: string;
  jurisdiction: string;
}

export interface ReportTenant {
  id: string;
  slug: string;
  name: string;
}

export interface ReportInput {
  reportId: string;
  generatedAt: string;
  tenant: ReportTenant;
  locale: Locale | string;
  jurisdiction: string;
  events: ReportEvent[];
  timestampsByEventId: Record<number, ReportTimestamp[]>;
  chainStatus:
    | { ok: true; verified: number }
    | { ok: false; reason: string; atSeq: number };
  /**
   * Base URL of the public verification page, used to embed a QR code on the
   * cover. The PDF appends the reportId as a query parameter so a verifier
   * can scan it and land on the right record.
   */
  verificationUrl: string;
}

export interface ReportResult {
  pdf: Buffer;
  sha256: string;
  pageCount: number;
}

const PAGE_MARGINS = { top: 56, bottom: 56, left: 56, right: 56 };

export async function renderReport(input: ReportInput): Promise<ReportResult> {
  const locale = resolveLocale(typeof input.locale === 'string' ? input.locale : 'pt-BR');
  const m = messages(locale);

  const doc = new PDFDocument({
    size: 'A4',
    margins: PAGE_MARGINS,
    bufferPages: true,
    info: {
      Title: m.reportTitle,
      Author: 'EVIDENCE',
      Subject: `Chain of Custody Report ${input.reportId}`,
      Producer: 'EVIDENCE',
      Creator: 'EVIDENCE',
      // Use deterministic dates so the PDF is byte-reproducible for a given input.
      CreationDate: new Date(input.generatedAt),
      ModDate: new Date(input.generatedAt),
    },
  });

  const verificationFullUrl = `${input.verificationUrl}?report=${encodeURIComponent(input.reportId)}`;
  const qrPng = await QRCode.toBuffer(verificationFullUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 200,
  });

  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done: Promise<Buffer> = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // ---------- Cover ----------
  doc.font('Helvetica-Bold').fontSize(22).text(m.reportTitle, { align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(11).fillColor('#555').text(m.reportSubtitle, { align: 'center' });
  doc.fillColor('black').moveDown(2);

  drawKV(doc, m.generatedAt, input.generatedAt);
  drawKV(doc, m.reportId, input.reportId);
  drawKV(doc, m.tenant, `${input.tenant.name} (${input.tenant.slug})`);
  drawKV(doc, m.locale, locale);
  drawKV(doc, m.jurisdiction, input.jurisdiction);

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(13).text(m.scopeHeading);
  doc.font('Helvetica').fontSize(11).moveDown(0.3);
  const range = input.events.length
    ? `${input.events[0].seq} – ${input.events[input.events.length - 1].seq}`
    : '–';
  drawKV(doc, m.scopeRange, range);
  drawKV(doc, m.totalEvents, String(input.events.length));

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(13).text(m.chainStatusHeading);
  doc.font('Helvetica').fontSize(11).moveDown(0.3);
  if (input.chainStatus.ok) {
    doc.fillColor('#0a6b2a').text(m.chainOk).fillColor('black');
    doc.text(m.chainVerifiedCount(input.chainStatus.verified));
  } else {
    doc.fillColor('#a31515').font('Helvetica-Bold').text(m.chainTampered).font('Helvetica').fillColor('black');
    doc.text(`${input.chainStatus.reason} (seq=${input.chainStatus.atSeq})`);
  }

  // QR code on the cover, anchored to the right margin
  const qrX = doc.page.width - PAGE_MARGINS.right - 120;
  const qrY = PAGE_MARGINS.top + 30;
  doc.image(qrPng, qrX, qrY, { width: 120 });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#555')
    .text(m.verificationUrlLabel, qrX, qrY + 130, { width: 120, align: 'center' })
    .text(verificationFullUrl, qrX, qrY + 145, { width: 120, align: 'center' })
    .fillColor('black');

  // ---------- Event list ----------
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(16).text(m.eventListHeading);
  doc.moveDown(0.5);

  for (const ev of input.events) {
    if (doc.y > doc.page.height - PAGE_MARGINS.bottom - 160) {
      doc.addPage();
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(`${m.eventSeq}: ${ev.seq}`);
    doc.font('Helvetica').fontSize(10);
    drawKV(doc, m.eventSource, ev.source);
    drawKV(doc, m.eventCreatedAt, ev.createdAt);
    drawHash(doc, m.eventPayloadHash, ev.payloadHash);
    drawHash(doc, m.eventChainHash, ev.chainHash);

    const stamps = input.timestampsByEventId[ev.seq] ?? [];
    if (stamps.length > 0) {
      doc.moveDown(0.2).font('Helvetica-Bold').fontSize(10).text(m.tsaHeading);
      doc.font('Helvetica').fontSize(9);
      for (const t of stamps) {
        drawKV(doc, m.tsaProvider, `${t.provider} (${t.jurisdiction})`);
        drawKV(doc, m.tsaIssuedAt, t.issuedAt);
        drawHash(doc, m.tsaDigest, t.digestHex);
      }
    }
    doc.moveDown(0.6);
  }

  // ---------- Verification instructions ----------
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(16).text(m.verificationHeading);
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(11);
  for (const line of m.verificationInstructions) {
    doc.text('• ' + line);
    doc.moveDown(0.2);
  }
  doc.moveDown(1);
  doc.fillColor('#0066cc').text(verificationFullUrl, { link: verificationFullUrl }).fillColor('black');

  // ---------- Footer (added before end) ----------
  const range2 = doc.bufferedPageRange();
  for (let i = 0; i < range2.count; i++) {
    doc.switchToPage(range2.start + i);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#777')
      .text(
        `${m.footerLine}   |   ${m.page(i + 1, range2.count)}`,
        PAGE_MARGINS.left,
        doc.page.height - PAGE_MARGINS.bottom + 20,
        { align: 'center', width: doc.page.width - PAGE_MARGINS.left - PAGE_MARGINS.right },
      )
      .fillColor('black');
  }

  doc.end();
  const pdf = await done;
  return { pdf, sha256: sha256Hex(pdf), pageCount: range2.count };
}

function drawKV(doc: PDFKit.PDFDocument, key: string, value: string): void {
  doc.font('Helvetica-Bold').text(`${key}: `, { continued: true }).font('Helvetica').text(value);
}

function drawHash(doc: PDFKit.PDFDocument, key: string, value: string): void {
  doc.font('Helvetica-Bold').text(`${key}: `);
  doc.font('Courier').fontSize(9).text(value, { width: 480 });
  doc.font('Helvetica').fontSize(10);
}
