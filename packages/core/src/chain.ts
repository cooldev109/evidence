import { GENESIS_PREV_HASH, hashPayload, sha256Hex } from './hash.js';

export interface ChainLinkInput {
  seq: number;
  tenantId: string;
  payloadHash: string;
  prevHash: string;
  createdAt: string;
}

export function computeChainHash(link: ChainLinkInput): string {
  const fields = [
    link.seq.toString(10),
    link.tenantId,
    link.payloadHash,
    link.prevHash,
    link.createdAt,
  ];
  return sha256Hex(fields.join('|'));
}

export interface ChainRecord {
  seq: number;
  tenantId: string;
  payloadHash: string;
  prevHash: string;
  chainHash: string;
  createdAt: string;
  /**
   * The original event payload. Optional: when provided, verifyChain also
   * confirms that hashPayload(payload) === payloadHash, which catches direct
   * tampering of the stored payload even when payload_hash was left intact.
   * Omit it (e.g. when only the hashes are available) to skip that check.
   */
  payload?: unknown;
}

export type ChainVerificationOk = { ok: true; verified: number };
export type ChainVerificationErr = {
  ok: false;
  reason:
    | 'genesis-mismatch'
    | 'sequence-gap'
    | 'tenant-mismatch'
    | 'hash-mismatch'
    | 'payload-hash-mismatch';
  atSeq: number;
  detail: string;
};
export type ChainVerificationResult = ChainVerificationOk | ChainVerificationErr;

export function verifyChain(
  records: ChainRecord[],
  expectedTenantId: string,
): ChainVerificationResult {
  if (records.length === 0) {
    return { ok: true, verified: 0 };
  }
  const sorted = [...records].sort((a, b) => a.seq - b.seq);
  let prevSeq = sorted[0].seq - 1;
  let prevHash = sorted[0].prevHash;
  const isStartFromGenesis = sorted[0].seq === 1;
  if (isStartFromGenesis && prevHash !== GENESIS_PREV_HASH) {
    return {
      ok: false,
      reason: 'genesis-mismatch',
      atSeq: sorted[0].seq,
      detail: `Genesis record must have prevHash=${GENESIS_PREV_HASH}, got ${prevHash}`,
    };
  }
  for (const rec of sorted) {
    if (rec.tenantId !== expectedTenantId) {
      return {
        ok: false,
        reason: 'tenant-mismatch',
        atSeq: rec.seq,
        detail: `Record seq=${rec.seq} belongs to tenant ${rec.tenantId}, expected ${expectedTenantId}`,
      };
    }
    if (rec.seq !== prevSeq + 1) {
      return {
        ok: false,
        reason: 'sequence-gap',
        atSeq: rec.seq,
        detail: `Expected seq=${prevSeq + 1}, got seq=${rec.seq}`,
      };
    }
    if (rec.prevHash !== prevHash) {
      return {
        ok: false,
        reason: 'hash-mismatch',
        atSeq: rec.seq,
        detail: `Record seq=${rec.seq} prevHash=${rec.prevHash} does not match previous chainHash=${prevHash}`,
      };
    }
    // If the raw payload is available, confirm it still hashes to the committed
    // payloadHash. This catches tampering of the stored payload that left
    // payload_hash untouched (the chain-hash check below trusts payloadHash).
    if (rec.payload !== undefined) {
      const recomputed = hashPayload(rec.payload);
      if (recomputed !== rec.payloadHash) {
        return {
          ok: false,
          reason: 'payload-hash-mismatch',
          atSeq: rec.seq,
          detail: `Record seq=${rec.seq} payload no longer matches payloadHash (recomputed=${recomputed}, stored=${rec.payloadHash})`,
        };
      }
    }
    const expectedHash = computeChainHash({
      seq: rec.seq,
      tenantId: rec.tenantId,
      payloadHash: rec.payloadHash,
      prevHash: rec.prevHash,
      createdAt: rec.createdAt,
    });
    if (expectedHash !== rec.chainHash) {
      return {
        ok: false,
        reason: 'hash-mismatch',
        atSeq: rec.seq,
        detail: `Record seq=${rec.seq} chainHash=${rec.chainHash} does not match recomputed hash=${expectedHash}`,
      };
    }
    prevSeq = rec.seq;
    prevHash = rec.chainHash;
  }
  return { ok: true, verified: sorted.length };
}
