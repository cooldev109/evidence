import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { setupTestContext, resetDb, type TestContext } from './setup.js';
import { createApiKey, createTenant } from '../src/tenants/repository.js';
import { verifyChain } from '@evidence/core';

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

async function seedTenant(slug = 'acme'): Promise<{ tenantId: string; key: string }> {
  const tenant = await createTenant(ctx.sql, { slug, name: 'Acme', locale: 'pt-BR' });
  const k = await createApiKey(ctx.sql, tenant.id, 'test');
  return { tenantId: tenant.id, key: k.plaintext };
}

async function post(path: string, key: string, body: unknown, extra: Record<string, string> = {}) {
  return ctx.app.inject({
    method: 'POST',
    url: path,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra },
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

describe('POST /v1/events', () => {
  it('rejects requests without auth', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/events',
      payload: { source: 's', payload: { x: 1 } },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with invalid api key', async () => {
    const res = await post('/v1/events', 'evk_invalidkey', { source: 's', payload: { x: 1 } });
    expect(res.statusCode).toBe(401);
  });

  it('appends a genesis event with prevHash=0...0 and seq=1', async () => {
    const { key } = await seedTenant();
    const res = await post('/v1/events', key, { source: 'app', payload: { hello: 'world' } });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { event: { seq: number; prevHash: string; chainHash: string } };
    expect(body.event.seq).toBe(1);
    expect(body.event.prevHash).toBe('0'.repeat(64));
    expect(body.event.chainHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('links subsequent events into a hash chain', async () => {
    const { key } = await seedTenant();
    const r1 = await post('/v1/events', key, { source: 'app', payload: { i: 1 } });
    const r2 = await post('/v1/events', key, { source: 'app', payload: { i: 2 } });
    const e1 = r1.json().event;
    const e2 = r2.json().event;
    expect(e2.seq).toBe(2);
    expect(e2.prevHash).toBe(e1.chainHash);
  });

  it('is idempotent when externalId is repeated', async () => {
    const { key } = await seedTenant();
    const body = { source: 'stripe', externalId: 'evt_123', payload: { amount: 1000 } };
    const r1 = await post('/v1/events', key, body);
    const r2 = await post('/v1/events', key, body);
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(200);
    const b1 = r1.json();
    const b2 = r2.json();
    expect(b2.idempotent).toBe(true);
    expect(b2.event.id).toBe(b1.event.id);
  });

  it('isolates events between tenants', async () => {
    const a = await seedTenant('a');
    const b = await seedTenant('b');
    await post('/v1/events', a.key, { source: 'x', payload: { a: 1 } });
    await post('/v1/events', a.key, { source: 'x', payload: { a: 2 } });
    await post('/v1/events', b.key, { source: 'x', payload: { b: 1 } });

    const listA = (await get('/v1/events', a.key)).json();
    const listB = (await get('/v1/events', b.key)).json();
    expect(listA.events).toHaveLength(2);
    expect(listB.events).toHaveLength(1);
    expect(listA.events[0].tenantId).not.toBe(listB.events[0].tenantId);
  });
});

describe('GET /v1/events', () => {
  it('paginates with cursor', async () => {
    const { key } = await seedTenant();
    for (let i = 0; i < 5; i++) {
      await post('/v1/events', key, { source: 'x', payload: { i } });
    }
    const r1 = (await get('/v1/events?limit=2', key)).json();
    expect(r1.events).toHaveLength(2);
    expect(r1.nextCursor).toBe(2);
    const r2 = (await get(`/v1/events?limit=2&cursor=${r1.nextCursor}`, key)).json();
    expect(r2.events).toHaveLength(2);
    expect(r2.events[0].seq).toBe(3);
  });
});

describe('GET /v1/verify', () => {
  it('verifies a clean chain', async () => {
    const { key } = await seedTenant();
    for (let i = 0; i < 5; i++) {
      await post('/v1/events', key, { source: 'x', payload: { i } });
    }
    const res = (await get('/v1/verify', key)).json();
    expect(res.result.ok).toBe(true);
    expect(res.result.verified).toBe(5);
  });

  it('detects tampering when an event payload is mutated in the DB', async () => {
    const { key, tenantId } = await seedTenant('tamper');
    for (let i = 0; i < 3; i++) {
      await post('/v1/events', key, { source: 'x', payload: { i } });
    }
    // Mutate the payload of the 2nd event directly
    await ctx.sql.unsafe(`
      UPDATE events
      SET payload = '{"i":999}'::jsonb
      WHERE tenant_id = '${tenantId}' AND seq = 2
    `);
    // Recompute payload_hash to simulate a more sophisticated tamper that also
    // updates payload_hash but leaves chain_hash unchanged: chain should still detect.
    await ctx.sql.unsafe(`
      UPDATE events
      SET payload_hash = encode(sha256('{"i":999}'::bytea), 'hex')
      WHERE tenant_id = '${tenantId}' AND seq = 2
    `);
    const res = (await get('/v1/verify', key)).json();
    expect(res.result.ok).toBe(false);
    expect(res.result.reason).toBe('hash-mismatch');
    expect(res.result.atSeq).toBe(2);
  });
});

describe('POST /v1/webhooks/:source', () => {
  it('rejects requests with bad signature', async () => {
    const { key } = await seedTenant();
    const body = { externalId: 'wh_1', payload: { x: 1 } };
    const res = await post('/v1/webhooks/stripe', key, body, {
      'x-evidence-signature': 'bogus',
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts requests with valid signature and appends to chain', async () => {
    const { key } = await seedTenant();
    const body = { externalId: 'wh_2', payload: { x: 2 } };
    const sig = createHmac('sha256', 'test-secret-1234')
      .update(JSON.stringify(body))
      .digest('hex');
    const res = await post('/v1/webhooks/stripe', key, body, {
      'x-evidence-signature': sig,
    });
    expect(res.statusCode).toBe(201);
    const b = res.json();
    expect(b.event.source).toBe('stripe');
    expect(b.event.externalId).toBe('wh_2');
  });
});

describe('chain integrity under concurrency', () => {
  it('handles 50 concurrent appends to the same tenant without forks', async () => {
    const { key, tenantId } = await seedTenant('concurrent');
    const N = 50;
    const responses = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        post('/v1/events', key, { source: 'load', payload: { i } }),
      ),
    );
    const created = responses.filter((r) => r.statusCode === 201);
    expect(created.length).toBe(N);

    // Confirm sequences are dense from 1..N
    const verifyRes = (await get('/v1/verify', key)).json();
    expect(verifyRes.result.ok).toBe(true);
    expect(verifyRes.result.verified).toBe(N);

    // Cross-check: fetch all events and re-verify with the standalone library
    const all = await ctx.sql.unsafe(`
      SELECT seq, tenant_id, payload_hash, prev_hash, chain_hash, created_at::text
      FROM events
      WHERE tenant_id = '${tenantId}'
      ORDER BY seq
    `);
    const records = all.map((r: Record<string, unknown>) => ({
      seq: Number(r.seq),
      tenantId: String(r.tenant_id),
      payloadHash: String(r.payload_hash),
      prevHash: String(r.prev_hash),
      chainHash: String(r.chain_hash),
      createdAt: String(r.created_at),
    }));
    const result = verifyChain(records, tenantId);
    expect(result.ok).toBe(true);
  });
});
