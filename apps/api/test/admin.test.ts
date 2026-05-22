import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestContext, resetDb, type TestContext } from './setup.js';
import { createApiKey, createTenant } from '../src/tenants/repository.js';
import { createAdminUser } from '../src/admin/repository.js';

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

async function seedTenantWithAdmin(slug = 'admin-t', locale = 'pt-BR') {
  const tenant = await createTenant(ctx.sql, { slug, name: 'Admin Tenant', locale });
  const apiKey = await createApiKey(ctx.sql, tenant.id, 'ingest');
  await createAdminUser(ctx.sql, {
    tenantId: tenant.id,
    email: `admin@${slug}.test`,
    password: 'correct-horse',
  });
  return { tenantId: tenant.id, email: `admin@${slug}.test`, apiKey: apiKey.plaintext };
}

async function login(email: string, password: string) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/admin/v1/login',
    headers: { 'content-type': 'application/json' },
    payload: { email, password },
  });
  return res;
}

function authGet(path: string, token: string) {
  return ctx.app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${token}` } });
}
function authPost(path: string, token: string, body: unknown) {
  return ctx.app.inject({
    method: 'POST',
    url: path,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: body as object,
  });
}

describe('Admin auth', () => {
  it('rejects bad credentials', async () => {
    const { email } = await seedTenantWithAdmin();
    const res = await login(email, 'wrong-password');
    expect(res.statusCode).toBe(401);
  });

  it('logs in with correct credentials and returns a JWT', async () => {
    const { email, tenantId } = await seedTenantWithAdmin();
    const res = await login(email, 'correct-horse');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(body.user.tenantId).toBe(tenantId);
  });

  it('rejects admin endpoints without a token', async () => {
    const res = await authGet('/admin/v1/overview', 'not-a-token');
    expect(res.statusCode).toBe(401);
  });
});

describe('Admin endpoints', () => {
  it('overview returns tenant + event count + chain status', async () => {
    const { email, apiKey } = await seedTenantWithAdmin('ov');
    // ingest a couple of events via the tenant API key
    for (let i = 0; i < 2; i++) {
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/events',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        payload: { source: 'app', payload: { i } },
      });
    }
    const token = (await login(email, 'correct-horse')).json().token;
    const ov = (await authGet('/admin/v1/overview', token)).json();
    expect(ov.eventCount).toBe(2);
    expect(ov.chain.ok).toBe(true);
    expect(ov.tenant.slug).toBe('ov');
  });

  it('lists events scoped to the admin tenant', async () => {
    const { email, apiKey } = await seedTenantWithAdmin('ev');
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      payload: { source: 'app', payload: { x: 1 } },
    });
    const token = (await login(email, 'correct-horse')).json().token;
    const list = (await authGet('/admin/v1/events', token)).json();
    expect(list.events).toHaveLength(1);
  });

  it('event detail returns the captured content + timestamp (the evidence)', async () => {
    const { email, apiKey } = await seedTenantWithAdmin('detail');
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      payload: { source: 'ata', payload: { tipo: 'Ata', valor: 48000 } },
    });
    const eventId = created.json().event.id;
    const token = (await login(email, 'correct-horse')).json().token;
    const detail = (await authGet(`/admin/v1/events/${eventId}`, token)).json();
    expect(detail.payload).toEqual({ tipo: 'Ata', valor: 48000 });
    expect(detail.timestamps).toHaveLength(1);
    expect(detail.timestamps[0].provider).toBe('mock');
    expect(detail.event.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creates and revokes API keys, and records audit', async () => {
    const { email } = await seedTenantWithAdmin('keys');
    const token = (await login(email, 'correct-horse')).json().token;
    const created = await authPost('/admin/v1/api-keys', token, { label: 'new-key' });
    expect(created.statusCode).toBe(201);
    const keyId = created.json().id;
    expect(created.json().key).toMatch(/^evk_/);

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/admin/v1/api-keys/${keyId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(200);

    const audit = (await authGet('/admin/v1/audit', token)).json();
    const actions = audit.events.map((e: { action: string }) => e.action);
    expect(actions).toContain('api_key.create');
    expect(actions).toContain('api_key.revoke');
    expect(actions).toContain('login');
  });

  it('generates a PDF report via admin', async () => {
    const { email, apiKey } = await seedTenantWithAdmin('rep');
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      payload: { source: 'app', payload: { x: 1 } },
    });
    const token = (await login(email, 'correct-horse')).json().token;
    const res = await authPost('/admin/v1/reports', token, { locale: 'en-US' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(res.rawPayload).slice(0, 5).toString()).toBe('%PDF-');
  });

  it('updates tenant locale via settings', async () => {
    const { email } = await seedTenantWithAdmin('settings', 'pt-BR');
    const token = (await login(email, 'correct-horse')).json().token;
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/admin/v1/settings',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { locale: 'es-ES' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tenant.locale).toBe('es-ES');
  });

  it('isolates one admin from another tenant data', async () => {
    const a = await seedTenantWithAdmin('admin-a');
    const b = await seedTenantWithAdmin('admin-b');
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { authorization: `Bearer ${a.apiKey}`, 'content-type': 'application/json' },
      payload: { source: 'app', payload: { who: 'a' } },
    });
    const tokenB = (await login(b.email, 'correct-horse')).json().token;
    const listB = (await authGet('/admin/v1/events', tokenB)).json();
    expect(listB.events).toHaveLength(0);
  });
});
