import { GENESIS_PREV_HASH, computeChainHash, hashPayload } from '@evidence/core';
import type { PgClient } from '../db/client.js';
import { withTenant } from '../db/tenant-context.js';

export interface AppendEventInput {
  tenantId: string;
  source: string;
  externalId?: string | null;
  payload: unknown;
}

export interface AppendedEvent {
  id: string;
  tenantId: string;
  seq: number;
  source: string;
  externalId: string | null;
  payloadHash: string;
  prevHash: string;
  chainHash: string;
  createdAt: string;
}

export class IdempotencyConflict extends Error {
  constructor(public existing: AppendedEvent) {
    super('External ID already exists for this tenant + source');
  }
}

interface TipRow {
  tenant_id: string;
  seq: string;
  chain_hash: string;
}

interface EventRow {
  id: string;
  tenant_id: string;
  seq: string | number;
  source: string;
  external_id: string | null;
  payload_hash: string;
  prev_hash: string;
  chain_hash: string;
  created_at: string | Date;
}

function toIso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : v;
}

function rowToEvent(row: EventRow): AppendedEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    seq: Number(row.seq),
    source: row.source,
    externalId: row.external_id,
    payloadHash: row.payload_hash,
    prevHash: row.prev_hash,
    chainHash: row.chain_hash,
    createdAt: toIso(row.created_at),
  };
}

/**
 * Append an event atomically to the per-tenant chain. Uses a SELECT ... FOR UPDATE
 * on the tenant's tip row so concurrent appends to the same tenant are serialized
 * (no chain forks).
 */
export async function appendEvent(
  sql: PgClient,
  input: AppendEventInput,
): Promise<AppendedEvent> {
  const payloadHash = hashPayload(input.payload);
  return withTenant(sql, input.tenantId, async (tx) => {
    // Idempotency check
    if (input.externalId) {
      const existing = await tx<EventRow[]>`
        SELECT * FROM events
        WHERE tenant_id = ${input.tenantId}
          AND source = ${input.source}
          AND external_id = ${input.externalId}
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new IdempotencyConflict(rowToEvent(existing[0]));
      }
    }

    // Lock tip row (or insert genesis tip if first event)
    const tipRows = await tx<TipRow[]>`
      INSERT INTO tenant_chain_tips (tenant_id, seq, chain_hash)
      VALUES (${input.tenantId}, 0, ${GENESIS_PREV_HASH})
      ON CONFLICT (tenant_id) DO NOTHING
      RETURNING tenant_id, seq, chain_hash
    `;
    let tip: TipRow;
    if (tipRows.length === 0) {
      const locked = await tx<TipRow[]>`
        SELECT tenant_id, seq, chain_hash
        FROM tenant_chain_tips
        WHERE tenant_id = ${input.tenantId}
        FOR UPDATE
      `;
      tip = locked[0];
    } else {
      tip = tipRows[0];
    }

    const nextSeq = Number(tip.seq) + 1;
    const prevHash = tip.chain_hash;

    // Use an application-generated ISO timestamp so the same string is used
    // for both the chain-hash input and the persisted column. This avoids any
    // ambiguity between Postgres timestamp formatting and JS Date parsing.
    const createdAt = new Date().toISOString();
    const chainHash = computeChainHash({
      seq: nextSeq,
      tenantId: input.tenantId,
      payloadHash,
      prevHash,
      createdAt,
    });

    const payloadJson = JSON.stringify(input.payload);
    const inserted = await tx<EventRow[]>`
      INSERT INTO events (
        tenant_id, seq, source, external_id, payload,
        payload_hash, prev_hash, chain_hash, created_at
      ) VALUES (
        ${input.tenantId}, ${nextSeq}, ${input.source}, ${input.externalId ?? null},
        ${payloadJson}::jsonb,
        ${payloadHash}, ${prevHash}, ${chainHash}, ${createdAt}
      )
      RETURNING *
    `;

    await tx`
      UPDATE tenant_chain_tips
      SET seq = ${nextSeq}, chain_hash = ${chainHash}, updated_at = now()
      WHERE tenant_id = ${input.tenantId}
    `;

    return rowToEvent(inserted[0]);
  });
}

export interface ListEventsOptions {
  tenantId: string;
  cursor?: number;
  limit?: number;
}

export async function listEvents(
  sql: PgClient,
  opts: ListEventsOptions,
): Promise<{ events: AppendedEvent[]; nextCursor: number | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const cursor = opts.cursor ?? 0;
  return withTenant(sql, opts.tenantId, async (tx) => {
    const rows = await tx<EventRow[]>`
      SELECT * FROM events
      WHERE tenant_id = ${opts.tenantId} AND seq > ${cursor}
      ORDER BY seq ASC
      LIMIT ${limit}
    `;
    const events = rows.map(rowToEvent);
    const nextCursor = events.length === limit ? events[events.length - 1].seq : null;
    return { events, nextCursor };
  });
}

export async function getEventById(
  sql: PgClient,
  tenantId: string,
  id: string,
): Promise<AppendedEvent | null> {
  return withTenant(sql, tenantId, async (tx) => {
    const rows = await tx<EventRow[]>`
      SELECT * FROM events WHERE tenant_id = ${tenantId} AND id = ${id} LIMIT 1
    `;
    return rows.length === 0 ? null : rowToEvent(rows[0]);
  });
}

export interface FetchChainRangeOptions {
  tenantId: string;
  fromSeq?: number;
  toSeq?: number;
}

export async function fetchChainRange(
  sql: PgClient,
  opts: FetchChainRangeOptions,
): Promise<AppendedEvent[]> {
  const from = opts.fromSeq ?? 1;
  const to = opts.toSeq ?? Number.MAX_SAFE_INTEGER;
  return withTenant(sql, opts.tenantId, async (tx) => {
    const rows = await tx<EventRow[]>`
      SELECT * FROM events
      WHERE tenant_id = ${opts.tenantId}
        AND seq >= ${from} AND seq <= ${to}
      ORDER BY seq ASC
    `;
    return rows.map(rowToEvent);
  });
}

export interface VerificationRecord extends AppendedEvent {
  payload: unknown;
}

/**
 * Like fetchChainRange but also returns the raw payload, so the verifier can
 * recompute the payload hash and detect direct tampering of the stored
 * payload (not just chain-structure tampering).
 */
export async function fetchChainForVerification(
  sql: PgClient,
  opts: FetchChainRangeOptions,
): Promise<VerificationRecord[]> {
  const from = opts.fromSeq ?? 1;
  const to = opts.toSeq ?? Number.MAX_SAFE_INTEGER;
  return withTenant(sql, opts.tenantId, async (tx) => {
    const rows = await tx<(EventRow & { payload: unknown })[]>`
      SELECT * FROM events
      WHERE tenant_id = ${opts.tenantId}
        AND seq >= ${from} AND seq <= ${to}
      ORDER BY seq ASC
    `;
    return rows.map((row) => ({ ...rowToEvent(row), payload: row.payload }));
  });
}
