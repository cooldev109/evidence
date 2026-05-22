import { randomBytes } from 'node:crypto';
import type { PgClient } from '../db/client.js';
import { withTenant } from '../db/tenant-context.js';

/**
 * ATA signers: the meeting participants who must click-to-sign an ATA. Each
 * carries an unguessable token for a public signing link; signing records a
 * separate chained + RFC-3161 event (signed_event_id) — see migration 0006.
 */

export interface AtaSigner {
  id: string;
  tenantId: string;
  captureId: string;
  eventId: string;
  name: string;
  email: string;
  token: string;
  signedAt: string | null;
  signedEventId: string | null;
  createdAt: string;
}

interface SignerRow {
  id: string;
  tenant_id: string;
  capture_id: string;
  event_id: string;
  name: string;
  email: string;
  token: string;
  signed_at: string | null;
  signed_event_id: string | null;
  created_at: string;
}

function rowToSigner(r: SignerRow): AtaSigner {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    captureId: r.capture_id,
    eventId: r.event_id,
    name: r.name,
    email: r.email,
    token: r.token,
    signedAt: r.signed_at,
    signedEventId: r.signed_event_id,
    createdAt: r.created_at,
  };
}

export function newSigningToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function createAtaSigners(
  sql: PgClient,
  input: {
    tenantId: string;
    captureId: string;
    eventId: string;
    participants: { name?: string; email?: string }[];
  },
): Promise<AtaSigner[]> {
  if (input.participants.length === 0) return [];
  const now = new Date().toISOString();
  return withTenant(sql, input.tenantId, async (tx) => {
    const created: AtaSigner[] = [];
    for (const p of input.participants) {
      const rows = await tx<SignerRow[]>`
        INSERT INTO ata_signers (tenant_id, capture_id, event_id, name, email, token, created_at)
        VALUES (${input.tenantId}, ${input.captureId}, ${input.eventId},
                ${p.name ?? ''}, ${p.email ?? ''}, ${newSigningToken()}, ${now})
        RETURNING *
      `;
      created.push(rowToSigner(rows[0]));
    }
    return created;
  });
}

export async function listSignersByCapture(
  sql: PgClient,
  tenantId: string,
  captureId: string,
): Promise<AtaSigner[]> {
  return withTenant(sql, tenantId, async (tx) => {
    const rows = await tx<SignerRow[]>`
      SELECT * FROM ata_signers
      WHERE tenant_id = ${tenantId} AND capture_id = ${captureId}
      ORDER BY created_at ASC
    `;
    return rows.map(rowToSigner);
  });
}

/** Public lookup by token — no tenant context (the signer is unauthenticated). */
export async function findSignerByToken(sql: PgClient, token: string): Promise<AtaSigner | null> {
  const rows = await sql<SignerRow[]>`
    SELECT * FROM ata_signers WHERE token = ${token} LIMIT 1
  `;
  return rows.length === 0 ? null : rowToSigner(rows[0]);
}

export async function markSignerSigned(
  sql: PgClient,
  tenantId: string,
  signerId: string,
  signedEventId: string,
  signedAt: string,
): Promise<void> {
  await withTenant(sql, tenantId, async (tx) => {
    await tx`
      UPDATE ata_signers
      SET signed_at = ${signedAt}, signed_event_id = ${signedEventId}
      WHERE tenant_id = ${tenantId} AND id = ${signerId} AND signed_at IS NULL
    `;
  });
}
