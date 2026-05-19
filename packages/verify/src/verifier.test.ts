import { describe, expect, it } from 'vitest';
import { canonicalJson, hashPayload, computeChainHash, GENESIS_PREV_HASH } from '@evidence/core';
import { MockTSAProvider } from '@evidence/tsa';
import { Verifier, type EvidenceEnvelope } from './verifier.js';

const TENANT = '11111111-2222-3333-4444-555555555555';
const CREATED = '2026-05-19T11:00:00.000Z';

async function buildEnvelope(payload: unknown, opts: { tamperPayload?: unknown } = {}): Promise<{ body: Buffer; envelope: EvidenceEnvelope }> {
  const payloadHash = hashPayload(payload);
  const seq = 1;
  const prevHash = GENESIS_PREV_HASH;
  const chainHash = computeChainHash({
    seq,
    tenantId: TENANT,
    payloadHash,
    prevHash,
    createdAt: CREATED,
  });
  const mock = new MockTSAProvider({ clock: () => new Date('2026-05-19T11:00:01.000Z') });
  const token = await mock.requestToken(payloadHash);

  const envelope: EvidenceEnvelope = {
    version: 1,
    event: {
      id: '0000ffff-aaaa-bbbb-cccc-deadbeef0000',
      tenantId: TENANT,
      seq,
      source: 'app',
      externalId: null,
      payload: opts.tamperPayload ?? payload,
      payloadHash,
      prevHash,
      chainHash,
      createdAt: CREATED,
    },
    timestamps: [
      {
        provider: 'mock',
        jurisdiction: 'BR',
        issuedAt: token.issuedAt,
        digestHex: token.digestHex,
        tokenBase64: token.token.toString('base64'),
      },
    ],
  };
  return { body: Buffer.from(canonicalJson(envelope), 'utf8'), envelope };
}

describe('Verifier.verifyEnvelope', () => {
  it('accepts a well-formed envelope', async () => {
    const { body } = await buildEnvelope({ hello: 'world' });
    const v = new Verifier();
    const r = await v.verifyEnvelope(body);
    expect(r.ok).toBe(true);
    expect(r.envelopeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.checks.payloadHash.ok).toBe(true);
    expect(r.checks.chainHash.ok).toBe(true);
    expect(r.checks.genesisIfFirst.ok).toBe(true);
    expect(r.checks.timestamps[0].digestMatchesPayload.ok).toBe(true);
    expect(r.checks.timestamps[0].providerVerification.ok).toBe(true);
  });

  it('detects payload tampering (payload changed after envelope built)', async () => {
    const { envelope } = await buildEnvelope({ hello: 'world' });
    envelope.event.payload = { hello: 'HACKED' };
    const tamperedBody = Buffer.from(JSON.stringify(envelope), 'utf8');
    const v = new Verifier();
    const r = await v.verifyEnvelope(tamperedBody);
    expect(r.ok).toBe(false);
    expect(r.checks.payloadHash.ok).toBe(false);
  });

  it('detects chain hash forgery', async () => {
    const { envelope } = await buildEnvelope({ hello: 'world' });
    envelope.event.chainHash = 'f'.repeat(64);
    const body = Buffer.from(JSON.stringify(envelope), 'utf8');
    const r = await new Verifier().verifyEnvelope(body);
    expect(r.ok).toBe(false);
    expect(r.checks.chainHash.ok).toBe(false);
  });

  it('detects genesis violation', async () => {
    const { envelope } = await buildEnvelope({ hello: 'world' });
    envelope.event.prevHash = 'a'.repeat(64);
    // Recompute chain hash so chainHash check passes; only genesis fails.
    envelope.event.chainHash = computeChainHash({
      seq: envelope.event.seq,
      tenantId: envelope.event.tenantId,
      payloadHash: envelope.event.payloadHash,
      prevHash: envelope.event.prevHash,
      createdAt: envelope.event.createdAt,
    });
    const body = Buffer.from(JSON.stringify(envelope), 'utf8');
    const r = await new Verifier().verifyEnvelope(body);
    expect(r.ok).toBe(false);
    expect(r.checks.genesisIfFirst.ok).toBe(false);
  });

  it('rejects tampered TSA token', async () => {
    const { envelope } = await buildEnvelope({ hello: 'world' });
    const original = Buffer.from(envelope.timestamps[0].tokenBase64, 'base64');
    original[original.length - 1] ^= 0x01;
    envelope.timestamps[0].tokenBase64 = original.toString('base64');
    const body = Buffer.from(JSON.stringify(envelope), 'utf8');
    const r = await new Verifier().verifyEnvelope(body);
    expect(r.ok).toBe(false);
    expect(r.checks.timestamps[0].providerVerification.ok).toBe(false);
  });
});
