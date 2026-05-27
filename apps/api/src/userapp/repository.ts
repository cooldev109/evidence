import { randomBytes } from 'node:crypto';
import type { PgClient } from '../db/client.js';
import { withTenant } from '../db/tenant-context.js';
import { hashPassword } from '../auth/password.js';

/**
 * End users (app_users) are the people an admin registers so they can log into
 * the capture app (Part 1) and produce evidence. Distinct from admin_users.
 *
 * captures links a stored media file to the hash-chained event that seals it,
 * so "Minhas Provas" (the user's own evidence) and admin review can list a
 * user's evidence with the file, geolocation, and RFC-3161 proof.
 */

export interface AppUser {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: string;
  lastLoginAt: string | null;
  disabledAt: string | null;
}

interface AppUserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  name: string;
  created_at: string;
  last_login_at: string | null;
  disabled_at: string | null;
}

function rowToUser(r: AppUserRow): AppUser {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    email: r.email,
    passwordHash: r.password_hash,
    name: r.name,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
    disabledAt: r.disabled_at,
  };
}

/** Login lookup — emails are globally unique (see app_users_email_idx). */
export async function findAppUserByEmail(sql: PgClient, email: string): Promise<AppUser | null> {
  const rows = await sql<AppUserRow[]>`
    SELECT * FROM app_users WHERE lower(email) = lower(${email}) LIMIT 1
  `;
  return rows.length === 0 ? null : rowToUser(rows[0]);
}

export async function findAppUserById(
  sql: PgClient,
  tenantId: string,
  id: string,
): Promise<AppUser | null> {
  return withTenant(sql, tenantId, async (tx) => {
    const rows = await tx<AppUserRow[]>`
      SELECT * FROM app_users WHERE tenant_id = ${tenantId} AND id = ${id} LIMIT 1
    `;
    return rows.length === 0 ? null : rowToUser(rows[0]);
  });
}

export class AppUserEmailTaken extends Error {
  constructor() {
    super('An end user with that email already exists');
  }
}

export async function createAppUser(
  sql: PgClient,
  input: { tenantId: string; email: string; password: string; name?: string },
): Promise<AppUser> {
  const existing = await findAppUserByEmail(sql, input.email);
  if (existing) throw new AppUserEmailTaken();
  const passwordHash = await hashPassword(input.password);
  const now = new Date().toISOString();
  return withTenant(sql, input.tenantId, async (tx) => {
    const rows = await tx<AppUserRow[]>`
      INSERT INTO app_users (tenant_id, email, password_hash, name, created_at)
      VALUES (${input.tenantId}, ${input.email}, ${passwordHash}, ${input.name ?? ''}, ${now})
      RETURNING *
    `;
    return rowToUser(rows[0]);
  });
}

export async function listAppUsers(sql: PgClient, tenantId: string): Promise<AppUser[]> {
  return withTenant(sql, tenantId, async (tx) => {
    const rows = await tx<AppUserRow[]>`
      SELECT * FROM app_users WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
    `;
    return rows.map(rowToUser);
  });
}

export async function setAppUserDisabled(
  sql: PgClient,
  tenantId: string,
  id: string,
  disabled: boolean,
): Promise<boolean> {
  const value = disabled ? new Date().toISOString() : null;
  return withTenant(sql, tenantId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      UPDATE app_users SET disabled_at = ${value}
      WHERE tenant_id = ${tenantId} AND id = ${id}
      RETURNING id
    `;
    return rows.length > 0;
  });
}

export async function touchAppUserLogin(sql: PgClient, id: string): Promise<void> {
  await sql`UPDATE app_users SET last_login_at = ${new Date().toISOString()} WHERE id = ${id}`;
}

// ---- Captures ----

export type CaptureKind = 'photo' | 'video' | 'audio' | 'ata';

export interface CaptureGeo {
  lat?: number;
  lng?: number;
  accuracy?: number;
  address?: string;
}

export interface Capture {
  id: string;
  tenantId: string;
  appUserId: string;
  eventId: string;
  kind: CaptureKind;
  title: string;
  contentType: string;
  sizeBytes: number;
  mediaSha256: string;
  store: string;
  objectKey: string;
  geo: CaptureGeo | null;
  capturedAt: string;
  createdAt: string;
  transcript: string | null;
  shareToken: string;
}

interface CaptureRow {
  id: string;
  tenant_id: string;
  app_user_id: string;
  event_id: string;
  kind: string;
  title: string;
  content_type: string;
  size_bytes: string | number;
  media_sha256: string;
  store: string;
  object_key: string;
  geo: CaptureGeo | null;
  captured_at: string;
  created_at: string;
  transcript: string | null;
  share_token: string;
}

function rowToCapture(r: CaptureRow): Capture {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    appUserId: r.app_user_id,
    eventId: r.event_id,
    kind: r.kind as CaptureKind,
    title: r.title,
    contentType: r.content_type,
    sizeBytes: Number(r.size_bytes),
    mediaSha256: r.media_sha256,
    store: r.store,
    objectKey: r.object_key,
    geo: r.geo,
    capturedAt: r.captured_at,
    createdAt: r.created_at,
    transcript: r.transcript ?? null,
    shareToken: r.share_token,
  };
}

/** 24 random bytes, base64url — same shape as the ATA signing token. */
export function newShareToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Public lookup by share token — no tenant context (recipient is anonymous). */
export async function findCaptureByShareToken(
  sql: PgClient,
  token: string,
): Promise<Capture | null> {
  const rows = await sql<CaptureRow[]>`
    SELECT * FROM captures WHERE share_token = ${token} LIMIT 1
  `;
  return rows.length === 0 ? null : rowToCapture(rows[0]);
}

export async function recordCapture(
  sql: PgClient,
  input: {
    tenantId: string;
    appUserId: string;
    eventId: string;
    kind: CaptureKind;
    title: string;
    contentType: string;
    sizeBytes: number;
    mediaSha256: string;
    store: string;
    objectKey: string;
    geo: CaptureGeo | null;
    capturedAt: string;
    transcript?: string | null;
  },
): Promise<Capture> {
  const now = new Date().toISOString();
  const geoJson = input.geo === null ? null : JSON.stringify(input.geo);
  const shareToken = newShareToken();
  return withTenant(sql, input.tenantId, async (tx) => {
    const rows = await tx<CaptureRow[]>`
      INSERT INTO captures (
        tenant_id, app_user_id, event_id, kind, title, content_type,
        size_bytes, media_sha256, store, object_key, geo, captured_at, created_at, transcript,
        share_token
      ) VALUES (
        ${input.tenantId}, ${input.appUserId}, ${input.eventId}, ${input.kind},
        ${input.title}, ${input.contentType}, ${input.sizeBytes}, ${input.mediaSha256},
        ${input.store}, ${input.objectKey}, ${geoJson}::jsonb, ${input.capturedAt}, ${now},
        ${input.transcript ?? null},
        ${shareToken}
      )
      RETURNING *
    `;
    return rowToCapture(rows[0]);
  });
}

/** Minhas Provas: a single user's own captures. */
export async function listCapturesByUser(
  sql: PgClient,
  tenantId: string,
  appUserId: string,
): Promise<Capture[]> {
  return withTenant(sql, tenantId, async (tx) => {
    const rows = await tx<CaptureRow[]>`
      SELECT * FROM captures
      WHERE tenant_id = ${tenantId} AND app_user_id = ${appUserId}
      ORDER BY created_at DESC
    `;
    return rows.map(rowToCapture);
  });
}

/** Admin review: all captures in a tenant, optionally filtered to one user. */
export async function listCapturesForTenant(
  sql: PgClient,
  tenantId: string,
  appUserId?: string,
): Promise<Capture[]> {
  return withTenant(sql, tenantId, async (tx) => {
    const rows = appUserId
      ? await tx<CaptureRow[]>`
          SELECT * FROM captures
          WHERE tenant_id = ${tenantId} AND app_user_id = ${appUserId}
          ORDER BY created_at DESC`
      : await tx<CaptureRow[]>`
          SELECT * FROM captures
          WHERE tenant_id = ${tenantId}
          ORDER BY created_at DESC`;
    return rows.map(rowToCapture);
  });
}

export async function getCapture(
  sql: PgClient,
  tenantId: string,
  id: string,
): Promise<Capture | null> {
  return withTenant(sql, tenantId, async (tx) => {
    const rows = await tx<CaptureRow[]>`
      SELECT * FROM captures WHERE tenant_id = ${tenantId} AND id = ${id} LIMIT 1
    `;
    return rows.length === 0 ? null : rowToCapture(rows[0]);
  });
}
