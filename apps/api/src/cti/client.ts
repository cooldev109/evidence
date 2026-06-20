import { createHmac, randomUUID } from 'node:crypto';
import type { PgClient } from '../db/client.js';
import type { CtiClient, CtiHttpConfig, CtiReport } from './types.js';

/**
 * Resolve a tenant's CNPJ as 14 digits, or null if the tenant has no CNPJ
 * set / has a malformed CNPJ. The Hub rejects malformed CNPJs with 422, so
 * we filter them here and log a warning rather than firing a doomed request.
 */
async function resolveCnpj(sql: PgClient, tenantId: string): Promise<string | null> {
  const rows = await sql<{ cnpj: string | null }[]>`
    SELECT cnpj FROM tenants WHERE id = ${tenantId} LIMIT 1
  `;
  const raw = rows[0]?.cnpj?.replace(/\D/g, '') ?? '';
  return raw.length === 14 ? raw : null;
}

/** Minimal pino-like logger so we don't drag the fastify Logger type in here. */
export interface CtiLogger {
  info(o: Record<string, unknown>, msg: string): void;
  warn(o: Record<string, unknown>, msg: string): void;
  error(o: Record<string, unknown>, msg: string): void;
}

const consoleLogger: CtiLogger = {
  info: (o, msg) => console.log(`[cti:info] ${msg}`, o),
  warn: (o, msg) => console.warn(`[cti:warn] ${msg}`, o),
  error: (o, msg) => console.error(`[cti:error] ${msg}`, o),
};

/**
 * Real CTI client. Implements the contract from
 * docs/cti-integracao-EVIDENCE.md exactly:
 *
 *   POST {base}/api/public/cti/ingest
 *   x-cti-client: <clientId>
 *   authorization: Bearer <apiKey>
 *   x-cti-timestamp: <ISO 8601>
 *   x-cti-nonce: <UUID>
 *   x-cti-signature: HMAC-SHA256-hex of `${ts}.${nonce}.${body}`
 *
 * Critically, the SAME body string is used both for the HMAC input and the
 * request body — re-serializing would silently produce a different byte
 * sequence (different key ordering, different escaping) and the signature
 * would fail validation server-side.
 */
export class HttpCtiClient implements CtiClient {
  private readonly timeoutMs: number;

  constructor(
    private readonly config: CtiHttpConfig,
    private readonly sql: PgClient,
    private readonly log: CtiLogger = consoleLogger,
  ) {
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  async report(input: CtiReport): Promise<void> {
    const cnpj = await resolveCnpj(this.sql, input.tenantId);
    if (!cnpj) {
      this.log.warn(
        { tenantId: input.tenantId, externalId: input.externalId, type: input.type },
        'CTI report skipped: tenant has no valid 14-digit CNPJ',
      );
      return;
    }

    const body = JSON.stringify({
      customer_cnpj: cnpj,
      external_id: input.externalId,
      event_type: input.type,
      title: input.title.slice(0, 300),
      description: input.description?.slice(0, 4000),
      priority: input.priority ?? 3,
      recommended_action: input.recommendedAction?.slice(0, 300),
      asset_ref: input.assetRef,
      payload: input.payload ?? {},
    });

    const timestamp = new Date().toISOString();
    const nonce = randomUUID();
    const signature = createHmac('sha256', this.config.hmacSecret)
      .update(`${timestamp}.${nonce}.${body}`)
      .digest('hex');

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/api/public/cti/ingest`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cti-client': this.config.clientId,
          authorization: `Bearer ${this.config.apiKey}`,
          'x-cti-timestamp': timestamp,
          'x-cti-nonce': nonce,
          'x-cti-signature': signature,
        },
        body,
        signal: ctrl.signal,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        // We log but don't throw — CTI being down must not break EVIDENCE saves.
        this.log.warn(
          { status: res.status, externalId: input.externalId, type: input.type, body: out },
          'CTI ingest non-2xx',
        );
        return;
      }
      this.log.info(
        {
          externalId: input.externalId,
          type: input.type,
          eventId: (out as { event_id?: string }).event_id,
          deduplicated: (out as { deduplicated?: boolean }).deduplicated ?? false,
        },
        'CTI report accepted',
      );
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err), externalId: input.externalId, type: input.type },
        'CTI ingest failed (network/timeout)',
      );
    } finally {
      clearTimeout(t);
    }
  }
}

/**
 * Stand-in client used when CTI credentials aren't configured. Doesn't talk
 * to anything; just logs that a report would have been sent. Lets dev /
 * staging environments operate without CTI creds while still being visible.
 */
export class NoopCtiClient implements CtiClient {
  constructor(private readonly log: CtiLogger = consoleLogger) {}

  async report(input: CtiReport): Promise<void> {
    this.log.info(
      {
        tenantId: input.tenantId,
        externalId: input.externalId,
        type: input.type,
        title: input.title,
      },
      'CTI report (noop — credentials not configured)',
    );
  }
}

/** For test seams — exposes the signature recipe identical to HttpCtiClient. */
export function signCtiRequest(
  hmacSecret: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return createHmac('sha256', hmacSecret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
}
