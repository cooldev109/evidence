import type { PgClient } from '../db/client.js';
import { generateApiKey, hashApiKey } from '../auth/api-key.js';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  locale: string;
}

export async function createTenant(
  sql: PgClient,
  input: { slug: string; name: string; locale?: string },
): Promise<Tenant> {
  const rows = await sql<Tenant[]>`
    INSERT INTO tenants (slug, name, locale)
    VALUES (${input.slug}, ${input.name}, ${input.locale ?? 'pt-BR'})
    RETURNING id, slug, name, locale
  `;
  return rows[0];
}

export async function createApiKey(
  sql: PgClient,
  tenantId: string,
  label: string,
): Promise<{ id: string; plaintext: string }> {
  const { plaintext, hash } = generateApiKey();
  const rows = await sql<{ id: string }[]>`
    INSERT INTO api_keys (tenant_id, key_hash, label)
    VALUES (${tenantId}, ${hash}, ${label})
    RETURNING id
  `;
  return { id: rows[0].id, plaintext };
}

export async function lookupTenantByApiKey(
  sql: PgClient,
  plaintext: string,
): Promise<Tenant | null> {
  const hash = hashApiKey(plaintext);
  const rows = await sql<Tenant[]>`
    SELECT t.id, t.slug, t.name, t.locale
    FROM api_keys k
    JOIN tenants t ON t.id = k.tenant_id
    WHERE k.key_hash = ${hash} AND k.revoked_at IS NULL
    LIMIT 1
  `;
  return rows.length === 0 ? null : rows[0];
}
