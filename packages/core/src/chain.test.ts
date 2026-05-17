import { describe, it, expect } from 'vitest';
import { computeChainHash, verifyChain, type ChainRecord } from './chain.js';
import { GENESIS_PREV_HASH, hashPayload } from './hash.js';

const T = 'tenant-1';
const ISO = '2026-01-01T00:00:00.000Z';

function buildChain(payloads: unknown[], tenantId = T, startAt = ISO): ChainRecord[] {
  let prevHash = GENESIS_PREV_HASH;
  const records: ChainRecord[] = [];
  payloads.forEach((p, idx) => {
    const seq = idx + 1;
    const payloadHash = hashPayload(p);
    const createdAt = new Date(new Date(startAt).getTime() + idx * 1000).toISOString();
    const chainHash = computeChainHash({ seq, tenantId, payloadHash, prevHash, createdAt });
    records.push({ seq, tenantId, payloadHash, prevHash, chainHash, createdAt });
    prevHash = chainHash;
  });
  return records;
}

describe('verifyChain', () => {
  it('accepts an empty chain', () => {
    expect(verifyChain([], T)).toEqual({ ok: true, verified: 0 });
  });

  it('accepts a valid single-record chain rooted at genesis', () => {
    const chain = buildChain([{ a: 1 }]);
    expect(verifyChain(chain, T)).toEqual({ ok: true, verified: 1 });
  });

  it('accepts a valid multi-record chain', () => {
    const chain = buildChain([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(verifyChain(chain, T)).toEqual({ ok: true, verified: 3 });
  });

  it('rejects a tampered payload hash', () => {
    const chain = buildChain([{ a: 1 }, { b: 2 }]);
    chain[1] = { ...chain[1], payloadHash: 'f'.repeat(64) };
    const result = verifyChain(chain, T);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('hash-mismatch');
      expect(result.atSeq).toBe(2);
    }
  });

  it('detects a sequence gap', () => {
    const chain = buildChain([{ a: 1 }, { b: 2 }, { c: 3 }]);
    chain.splice(1, 1);
    const result = verifyChain(chain, T);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('sequence-gap');
    }
  });

  it('detects a tenant mismatch', () => {
    const chain = buildChain([{ a: 1 }]);
    chain[0] = { ...chain[0], tenantId: 'other' };
    const result = verifyChain(chain, T);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('tenant-mismatch');
    }
  });

  it('detects a broken prevHash link', () => {
    const chain = buildChain([{ a: 1 }, { b: 2 }]);
    chain[1] = { ...chain[1], prevHash: '1'.repeat(64) };
    const result = verifyChain(chain, T);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('hash-mismatch');
    }
  });

  it('detects a genesis-mismatch when starting at seq=1 without zero prev', () => {
    const chain = buildChain([{ a: 1 }]);
    chain[0] = { ...chain[0], prevHash: 'a'.repeat(64) };
    const result = verifyChain(chain, T);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('genesis-mismatch');
    }
  });
});
