import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { HttpCtiClient, NoopCtiClient, signCtiRequest } from '../src/cti/index.js';
import type { CtiLogger } from '../src/cti/client.js';
import { setupTestContext, resetDb, type TestContext } from './setup.js';
import { createTenant } from '../src/tenants/repository.js';

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

// Capture the args of the last fetch call so each test can assert on it.
interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function mockFetch(
  status: number,
  responseBody: unknown,
): { fetch: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fakeFetch = (async (input, init) => {
    calls.push({
      url: typeof input === 'string' ? input : (input as URL).toString(),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries(init?.headers ?? {})),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    return new Response(JSON.stringify(responseBody), { status });
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, calls };
}

function silentLogger(): CtiLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('CTI signature recipe', () => {
  it('produces an HMAC-SHA256 hex digest of `${ts}.${nonce}.${body}`', () => {
    const ts = '2026-06-14T18:25:59.737Z';
    const nonce = 'b3c0e8a3-2e10-4f01-8b6f-1f7c4b1c91ea';
    const body = '{"customer_cnpj":"12345678000199","event_type":"x","title":"y"}';
    const secret = 'super-secret';

    const got = signCtiRequest(secret, ts, nonce, body);
    const want = createHmac('sha256', secret)
      .update(`${ts}.${nonce}.${body}`)
      .digest('hex');
    expect(got).toBe(want);
    expect(got).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('HttpCtiClient.report', () => {
  it('posts a well-formed signed request when the tenant has a valid CNPJ', async () => {
    const t = await createTenant(ctx.sql, { slug: 'cti-ok', name: 'CTI OK', locale: 'pt-BR' });
    await ctx.sql`UPDATE tenants SET cnpj = ${'12.345.678/0001-99'} WHERE id = ${t.id}`;

    const { fetch: fakeFetch, calls } = mockFetch(200, { ok: true, event_id: 'cti-evt-1' });
    // Patch globalThis.fetch on this test so the client picks up our mock.
    const origFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = fakeFetch;

    try {
      const client = new HttpCtiClient(
        {
          baseUrl: 'https://cti.example.test',
          clientId: 'evidence-test',
          apiKey: 'k-12345',
          hmacSecret: 's-secret',
        },
        ctx.sql,
        silentLogger(),
      );

      await client.report({
        tenantId: t.id,
        externalId: 'ext-1',
        type: 'ancoragem_falha',
        title: 'Test title',
        priority: 4,
        payload: { foo: 'bar' },
      });

      expect(calls).toHaveLength(1);
      const call = calls[0];
      expect(call.url).toBe('https://cti.example.test/api/public/cti/ingest');
      expect(call.method).toBe('POST');
      expect(call.headers['x-cti-client']).toBe('evidence-test');
      expect(call.headers['authorization']).toBe('Bearer k-12345');
      expect(call.headers['x-cti-timestamp']).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
      expect(call.headers['x-cti-nonce']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      // The body CNPJ is normalized to 14 digits.
      const parsed = JSON.parse(call.body);
      expect(parsed.customer_cnpj).toBe('12345678000199');
      expect(parsed.external_id).toBe('ext-1');
      expect(parsed.event_type).toBe('ancoragem_falha');
      expect(parsed.title).toBe('Test title');
      expect(parsed.priority).toBe(4);
      expect(parsed.payload).toEqual({ foo: 'bar' });
      // No `source` field — server derives origin from credential.
      expect(parsed.source).toBeUndefined();

      // The signature header was computed over the EXACT body string sent.
      const expectedSig = signCtiRequest(
        's-secret',
        call.headers['x-cti-timestamp'],
        call.headers['x-cti-nonce'],
        call.body,
      );
      expect(call.headers['x-cti-signature']).toBe(expectedSig);
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = origFetch;
    }
  });

  it('skips the POST when the tenant has no CNPJ (warns instead of failing)', async () => {
    const t = await createTenant(ctx.sql, { slug: 'cti-noc', name: 'No CNPJ', locale: 'pt-BR' });

    const { fetch: fakeFetch, calls } = mockFetch(200, {});
    const origFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = fakeFetch;
    const log = silentLogger();

    try {
      const client = new HttpCtiClient(
        {
          baseUrl: 'https://cti.example.test',
          clientId: 'evidence-test',
          apiKey: 'k-12345',
          hmacSecret: 's-secret',
        },
        ctx.sql,
        log,
      );
      await client.report({
        tenantId: t.id,
        externalId: 'ext-2',
        type: 'ancoragem_falha',
        title: 'should-not-fire',
      });
      expect(calls).toHaveLength(0);
      expect(log.warn).toHaveBeenCalled();
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = origFetch;
    }
  });

  it('does not throw when the server returns a non-2xx', async () => {
    const t = await createTenant(ctx.sql, { slug: 'cti-422', name: 'CTI 422', locale: 'pt-BR' });
    await ctx.sql`UPDATE tenants SET cnpj = ${'12345678000199'} WHERE id = ${t.id}`;

    const { fetch: fakeFetch } = mockFetch(422, { error: 'invalid_cnpj' });
    const origFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = fakeFetch;
    const log = silentLogger();

    try {
      const client = new HttpCtiClient(
        {
          baseUrl: 'https://cti.example.test',
          clientId: 'evidence-test',
          apiKey: 'k',
          hmacSecret: 's',
        },
        ctx.sql,
        log,
      );
      await expect(
        client.report({
          tenantId: t.id,
          externalId: 'ext-3',
          type: 'ancoragem_falha',
          title: 'srv-rejects',
        }),
      ).resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalled();
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = origFetch;
    }
  });
});

describe('NoopCtiClient', () => {
  it('logs and returns without throwing', async () => {
    const log = silentLogger();
    const client = new NoopCtiClient(log);
    await client.report({
      tenantId: 'whatever',
      externalId: 'ext',
      type: 'ancoragem_falha',
      title: 't',
    });
    expect(log.info).toHaveBeenCalled();
  });
});
