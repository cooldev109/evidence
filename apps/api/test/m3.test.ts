import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '@evidence/core';
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

async function seedTenant(slug = 'm3', locale = 'pt-BR') {
  const tenant = await createTenant(ctx.sql, { slug, name: 'M3 Tenant', locale });
  const k = await createApiKey(ctx.sql, tenant.id, 'm3-test');
  return { tenantId: tenant.id, key: k.plaintext };
}

async function post(path: string, key: string | null, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  return ctx.app.inject({ method: 'POST', url: path, headers, payload: body as object });
}

async function get(path: string, key: string | null) {
  const headers: Record<string, string> = {};
  if (key) headers.authorization = `Bearer ${key}`;
  return ctx.app.inject({ method: 'GET', url: path, headers });
}

describe('Root + meta routes', () => {
  it('GET / returns API metadata', async () => {
    const res = await get('/', null);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('EVIDENCE API');
    expect(body.milestones).toMatchObject({ m1: 'complete', m2: 'complete', m3: 'complete' });
    expect(body.endpoints.public_verify).toBe('/public/v1/verify');
  });

  it('GET /docs returns Swagger UI HTML', async () => {
    const res = await get('/docs/static/index.html', null);
    // swagger-ui serves index at /docs/static/index.html and redirects /docs to it
    expect([200, 302, 301]).toContain(res.statusCode);
  });
});

describe('POST /v1/reports (authenticated PDF generation)', () => {
  it('requires auth', async () => {
    const res = await post('/v1/reports', null, {});
    expect(res.statusCode).toBe(401);
  });

  it('returns a PDF with the expected headers', async () => {
    const { key } = await seedTenant();
    // Seed two events
    await post('/v1/events', key, { source: 'app', payload: { i: 1 } });
    await post('/v1/events', key, { source: 'app', payload: { i: 2 } });

    const res = await post('/v1/reports', key, {});
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['x-evidence-report-id']).toMatch(/^[a-f0-9]{8}-/);
    expect(res.headers['x-evidence-report-sha256']).toMatch(/^[0-9a-f]{64}$/);
    // PDF magic bytes
    const buf = Buffer.from(res.rawPayload);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    // Body hash matches the header
    expect(sha256Hex(buf)).toBe(res.headers['x-evidence-report-sha256']);
  });

  it('honors the locale override', async () => {
    const { key } = await seedTenant('locale-test', 'pt-BR');
    await post('/v1/events', key, { source: 'app', payload: { x: 1 } });
    const pt = await post('/v1/reports', key, { locale: 'pt-BR' });
    const en = await post('/v1/reports', key, { locale: 'en-US' });
    const es = await post('/v1/reports', key, { locale: 'es-ES' });
    const ptSha = sha256Hex(Buffer.from(pt.rawPayload));
    const enSha = sha256Hex(Buffer.from(en.rawPayload));
    const esSha = sha256Hex(Buffer.from(es.rawPayload));
    expect(ptSha).not.toBe(enSha);
    expect(ptSha).not.toBe(esSha);
    expect(enSha).not.toBe(esSha);
  });
});

describe('GET /public/v1/evidence/:id (no-auth)', () => {
  it('returns the canonical envelope without an auth header', async () => {
    const { key } = await seedTenant();
    const create = await post('/v1/events', key, { source: 'app', payload: { x: 1 } });
    const eventId = create.json().event.id;
    const expectedSha = create.json().evidence.sha256;

    const res = await get(`/public/v1/evidence/${eventId}`, null);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-evidence-sha256']).toBe(expectedSha);
    expect(sha256Hex(Buffer.from(res.rawPayload))).toBe(expectedSha);
  });

  it('returns 404 for unknown event id', async () => {
    const res = await get('/public/v1/evidence/00000000-0000-0000-0000-000000000000', null);
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /public/v1/verify (no-auth)', () => {
  it('verifies a valid envelope', async () => {
    const { key } = await seedTenant();
    const create = await post('/v1/events', key, { source: 'app', payload: { x: 1 } });
    const eventId = create.json().event.id;
    const envelopeRes = await get(`/public/v1/evidence/${eventId}`, null);
    const envelope = JSON.parse(envelopeRes.body);

    const verify = await post('/public/v1/verify', null, { envelope });
    expect(verify.statusCode).toBe(200);
    const body = verify.json();
    expect(body.ok).toBe(true);
    expect(body.envelopeSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a tampered envelope', async () => {
    const { key } = await seedTenant();
    const create = await post('/v1/events', key, { source: 'app', payload: { x: 1 } });
    const eventId = create.json().event.id;
    const envelopeRes = await get(`/public/v1/evidence/${eventId}`, null);
    const envelope = JSON.parse(envelopeRes.body);
    envelope.event.payload = { x: 999 }; // mutate payload, hash no longer matches

    const verify = await post('/public/v1/verify', null, { envelope });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().ok).toBe(false);
  });

  it('rejects a malformed body', async () => {
    const res = await post('/public/v1/verify', null, { envelope: 'not-json{' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /public/verify (HTML landing)', () => {
  it('serves an HTML landing page', async () => {
    const res = await get('/public/verify', null);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('EVIDENCE');
  });

  it('renders VERIFIED for a real event', async () => {
    const { key } = await seedTenant();
    const create = await post('/v1/events', key, { source: 'app', payload: { x: 1 } });
    const eventId = create.json().event.id;
    const res = await get(`/public/verify?event=${eventId}`, null);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('VERIFIED');
  });
});
