import type { PgClient } from '../db/client.js';
import { withTenant } from '../db/tenant-context.js';
import { hashPassword } from '../auth/password.js';

export interface AdminUser {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  role: string;
}

interface AdminUserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: string;
}

export async function findAdminByEmail(sql: PgClient, email: string): Promise<AdminUser | null> {
  const rows = await sql<AdminUserRow[]>`
    SELECT id, tenant_id, email, password_hash, role
    FROM admin_users WHERE lower(email) = lower(${email}) LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    tenantId: r.tenant_id,
    email: r.email,
    passwordHash: r.password_hash,
    role: r.role,
  };
}

export async function touchLogin(sql: PgClient, userId: string): Promise<void> {
  await sql`UPDATE admin_users SET last_login_at = ${new Date().toISOString()} WHERE id = ${userId}`;
}

export async function createAdminUser(
  sql: PgClient,
  input: { tenantId: string; email: string; password: string; role?: string },
): Promise<{ id: string }> {
  const passwordHash = await hashPassword(input.password);
  const now = new Date().toISOString();
  const rows = await sql<{ id: string }[]>`
    INSERT INTO admin_users (tenant_id, email, password_hash, role, created_at)
    VALUES (${input.tenantId}, ${input.email}, ${passwordHash}, ${input.role ?? 'admin'}, ${now})
    RETURNING id
  `;
  return rows[0];
}

export async function recordAudit(
  sql: PgClient,
  input: { tenantId: string; actorEmail: string; action: string; detail?: unknown },
): Promise<void> {
  const now = new Date().toISOString();
  const detailJson = input.detail === undefined ? null : JSON.stringify(input.detail);
  await withTenant(sql, input.tenantId, async (tx) => {
    await tx`
      INSERT INTO audit_events (tenant_id, actor_email, action, detail, created_at)
      VALUES (${input.tenantId}, ${input.actorEmail}, ${input.action}, ${detailJson}::jsonb, ${now})
    `;
  });
}

export interface AuditEntry {
  id: string;
  actorEmail: string;
  action: string;
  detail: unknown;
  createdAt: string;
}

export async function listAudit(
  sql: PgClient,
  tenantId: string,
  limit = 100,
): Promise<AuditEntry[]> {
  return withTenant(sql, tenantId, async (tx) => {
    const rows = await tx<
      { id: string; actor_email: string; action: string; detail: unknown; created_at: string }[]
    >`
      SELECT id, actor_email, action, detail, created_at
      FROM audit_events WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      actorEmail: r.actor_email,
      action: r.action,
      detail: r.detail,
      createdAt: r.created_at,
    }));
  });
}

export interface AdminApiKey {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
}

export async function listApiKeys(sql: PgClient, tenantId: string): Promise<AdminApiKey[]> {
  return withTenant(sql, tenantId, async (tx) => {
    const rows = await tx<
      { id: string; label: string; created_at: string; revoked_at: string | null }[]
    >`
      SELECT id, label, created_at::text, revoked_at::text
      FROM api_keys WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
    `;
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.created_at,
      revokedAt: r.revoked_at,
    }));
  });
}

export async function revokeApiKey(
  sql: PgClient,
  tenantId: string,
  keyId: string,
): Promise<boolean> {
  return withTenant(sql, tenantId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      UPDATE api_keys SET revoked_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${keyId} AND revoked_at IS NULL
      RETURNING id
    `;
    return rows.length > 0;
  });
}

export interface TenantSettings {
  slug: string;
  name: string;
  locale: string;
}

export async function getTenantSettings(
  sql: PgClient,
  tenantId: string,
): Promise<TenantSettings | null> {
  const rows = await sql<{ slug: string; name: string; locale: string }[]>`
    SELECT slug, name, locale FROM tenants WHERE id = ${tenantId} LIMIT 1
  `;
  return rows.length === 0 ? null : rows[0];
}

export async function updateTenantLocale(
  sql: PgClient,
  tenantId: string,
  locale: string,
): Promise<void> {
  await sql`UPDATE tenants SET locale = ${locale} WHERE id = ${tenantId}`;
}
