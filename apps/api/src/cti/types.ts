/**
 * Contract types for the CTI Trust Hub integration.
 *
 * EVIDENCE is a one-way "satellite" emitter — we POST findings ("achados");
 * the Hub presents them to the customer, captures their decision, and seals
 * the outcome on its own side. We never receive callbacks.
 *
 * Reference contract: docs/cti-integracao-EVIDENCE.md
 */

export interface CtiReport {
  /** Tenant whose CNPJ we'll resolve at send time. */
  tenantId: string;
  /** Stable EVIDENCE id used by CTI for idempotency. We use events.id. */
  externalId: string;
  /** Short machine code for the finding type (e.g. 'ancoragem_falha'). */
  type: string;
  /** Human-readable title (≤ 300 chars). */
  title: string;
  /** Optional detail (≤ 4000 chars). */
  description?: string;
  /** 1..5 — 1=low, 5=critical. Defaults to 3 on the wire. */
  priority?: number;
  /** One-line recommended action (≤ 300 chars). */
  recommendedAction?: string;
  /** Optional reference to a specific asset/resource. */
  assetRef?: string;
  /** Free-form payload with evidence and context (e.g. hashes, errors). */
  payload?: Record<string, unknown>;
}

export interface CtiClient {
  /** Fire a report. Throws only on programming errors; network failures and
   *  non-2xx responses are logged but not re-thrown so the caller (typically
   *  a request handler in a save flow) is never blocked by CTI being down. */
  report(input: CtiReport): Promise<void>;
}

export interface CtiHttpConfig {
  baseUrl: string;
  clientId: string;
  apiKey: string;
  hmacSecret: string;
  /** Per-attempt timeout in ms. Defaults to 8000. */
  timeoutMs?: number;
}

export class CtiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
  }
}
