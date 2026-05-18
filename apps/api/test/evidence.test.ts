import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { canonicalJson, hashPayload, sha256Hex } from '@evidence/core';
import { setupTestContext, resetDb, type TestContext } from './setup.js';
import { createApiKey, createTenant } from '../src/tenants/repository.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestContext();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await resetDb();
});

async function seedTenant(slug = 'm2', locale = 'pt-BR') {
  const tenant = await createTenant(ctx.sql, { slug, name: 'M2 Tenant', locale });
  const k = await createApiKey(ctx.sql, tenant.id, 'test');
  return { tenantId: tenant.id, key: k.plaintext, locale };
}

async function post(path: string, key: string, body: unknown) {
  return ctx.app.inject({
    method: 'POST',
    url: path,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    payload: body as object,
  });
}

async function get(path: string, key: string) {
  return ctx.app.inject({
    method: 'GET',
    url: path,
    headers: { authorization: `Bearer ${key}` },
  });
}

describe('POST /v1/events with evidence persistence', () => {
  it('returns an evidence reference with object key + sha + retention', async () => {
    const { key } = await seedTenant();
    const res = await post('/v1/events', key, { source: 'app', payload: { hello: 'world' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.evidence).toBeDefined();
    expect(body.evidence.objectKey).toMatch(/\.evd$/);
    expect(body.evidence.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.evidence.sizeBytes).toBeGreaterThan(0);
    expect(body.evidence.timestampIds).toHaveLength(1);
  });

  it('persists a TSA timestamp in event_timestamps', async () => {
    const { key, tenantId } = await seedTenant();
    const res = await post('/v1/events', key, { source: 'app', payload: { x: 1 } });
    const eventId = res.json().event.id;
    const rows = await ctx.sql.unsafe(
      `SELECT provider, jurisdiction, digest_hex FROM event_timestamps WHERE tenant_id = '${tenantId}' AND event_id = '${eventId}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe('mock');
    expect(rows[0].jurisdiction).toBe('BR');
    expect(rows[0].digest_hex).toBe(hashPayload({ x: 1 }));
  });

  it('persists an immutable evidence_objects row', async () => {
    const { key, tenantId } = await seedTenant();
    const res = await post('/v1/events', key, { source: 'app', payload: { y: 2 } });
    const eventId = res.json().event.id;
    const rows = await ctx.sql.unsafe(
      `SELECT store, bucket, object_key, sha256, retain_mode, retain_until
       FROM evidence_objects WHERE tenant_id = '${tenantId}' AND event_id = '${eventId}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].store).toBe('local');
    expect(rows[0].retain_mode).toBe('governance');
    expect(rows[0].retain_until).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // retain_until should be ~5 years out
    const retainYear = Number(String(rows[0].retain_until).slice(0, 4));
    const nowYear = new Date().getUTCFullYear();
    expect(retainYear).toBe(nowYear + 5);
  });
});

describe('GET /v1/events/:id/evidence', () => {
  it('returns the canonical envelope, byte-identical and re-hashes correctly', async () => {
    const { key } = await seedTenant();
    const payload = { greeting: 'olá', n: 42 };
    const created = await post('/v1/events', key, { source: 'app', payload });
    const eventId = created.json().event.id;
    const expectedSha = created.json().evidence.sha256;

    const ev = await get(`/v1/events/${eventId}/evidence`, key);
    expect(ev.statusCode).toBe(200);
    expect(ev.headers['x-evidence-sha256']).toBe(expectedSha);
    expect(sha256Hex(Buffer.from(ev.rawPayload))).toBe(expectedSha);

    const parsed = JSON.parse(ev.body);
    expect(parsed.version).toBe(1);
    expect(parsed.event.payload).toEqual(payload);
    expect(parsed.event.payloadHash).toBe(hashPayload(payload));
    expect(parsed.timestamps).toHaveLength(1);
    expect(parsed.timestamps[0].provider).toBe('mock');
    expect(parsed.timestamps[0].jurisdiction).toBe('BR');
    expect(parsed.timestamps[0].tokenBase64).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('returns 404 when evidence is not yet persisted', async () => {
    const { key } = await seedTenant();
    const res = await get('/v1/events/00000000-0000-0000-0000-000000000000/evidence', key);
    expect(res.statusCode).toBe(404);
  });
});

describe('evidence envelope is deterministic (canonical JSON)', () => {
  it('two events with same input produce same canonical bytes (modulo identifiers/timestamps)', async () => {
    const { key } = await seedTenant();
    const payload = { a: 1, b: { c: 2, d: 3 } };
    const reordered = { b: { d: 3, c: 2 }, a: 1 };
    const r1 = await post('/v1/events', key, { source: 'app', payload });
    const r2 = await post('/v1/events', key, { source: 'app', payload: reordered });
    // payload hashes match regardless of key order
    expect(r1.json().event.payloadHash).toBe(r2.json().event.payloadHash);
    // But chain hashes differ (seq/prev/createdAt differ), so envelopes differ.
    expect(r1.json().evidence.sha256).not.toBe(r2.json().evidence.sha256);

    // Independently re-canonicalize and confirm the property
    const cj1 = canonicalJson(payload);
    const cj2 = canonicalJson(reordered);
    expect(cj1).toBe(cj2);
  });
});

describe('locale → jurisdiction selection', () => {
  it.each([
    ['pt-BR', 'BR'],
    ['en-US', 'US'],
    ['es-ES', 'EU'],
  ])('tenant locale %s persists timestamp with jurisdiction %s', async (locale, j) => {
    const { key, tenantId } = await seedTenant(`loc-${locale}`, locale);
    await post('/v1/events', key, { source: 'app', payload: { l: locale } });
    const rows = await ctx.sql.unsafe(
      `SELECT jurisdiction FROM event_timestamps WHERE tenant_id = '${tenantId}'`,
    );
    expect(rows[0].jurisdiction).toBe(j);
  });
});
