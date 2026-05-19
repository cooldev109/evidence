import {
  computeChainHash,
  GENESIS_PREV_HASH,
  hashPayload,
  sha256Hex,
  verifyChain,
  type ChainRecord,
} from '@evidence/core';
import { MockTSAProvider, type TSAProvider } from '@evidence/tsa';

/**
 * Standalone verification engine. Operates on a canonical evidence envelope
 * (the same JSON that `GET /v1/events/:id/evidence` returns) and tells you
 * whether the envelope is intact:
 *
 *  - the payload still hashes to the recorded payloadHash
 *  - the chainHash recomputes correctly from the recorded fields
 *  - the TSA token, when verifiable, agrees on the payload digest
 *
 * Note: full RFC 3161 token verification (ASN.1 + cert chain) is performed
 * by a `TSAProvider` you inject. For the mock provider used in CI/dev, the
 * verifier checks the MAC. For real providers, plug their `verifyToken`
 * implementation in.
 */

export interface EnvelopeTimestamp {
  provider: string;
  jurisdiction: string;
  issuedAt: string;
  digestHex: string;
  tokenBase64: string;
}

export interface EnvelopeEvent {
  id: string;
  tenantId: string;
  seq: number;
  source: string;
  externalId: string | null;
  payload: unknown;
  payloadHash: string;
  prevHash: string;
  chainHash: string;
  createdAt: string;
}

export interface EvidenceEnvelope {
  version: 1;
  event: EnvelopeEvent;
  timestamps: EnvelopeTimestamp[];
}

export type FieldStatus = { ok: true } | { ok: false; reason: string };

export interface VerificationReport {
  ok: boolean;
  envelopeSha256: string;
  checks: {
    payloadHash: FieldStatus;
    chainHash: FieldStatus;
    genesisIfFirst: FieldStatus;
    timestamps: Array<{
      provider: string;
      digestMatchesPayload: FieldStatus;
      providerVerification: FieldStatus;
    }>;
  };
}

export interface VerifierOptions {
  /**
   * Providers that may be used to verify TSA tokens. The verifier matches
   * timestamp.provider against the provider's id. If no matching provider is
   * registered, the timestamp is reported as "no-verifier-available" rather
   * than failing the whole envelope.
   */
  tsaProviders?: TSAProvider[];
}

export class Verifier {
  private readonly providers: Map<string, TSAProvider>;

  constructor(opts: VerifierOptions = {}) {
    const list = opts.tsaProviders ?? [new MockTSAProvider()];
    this.providers = new Map(list.map((p) => [p.id, p]));
  }

  /** Recompute a chain-hash equivalence check on a single envelope. */
  async verifyEnvelope(rawBody: Buffer | string): Promise<VerificationReport> {
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
    const envelopeSha256 = sha256Hex(body);
    const envelope = JSON.parse(body.toString('utf8')) as EvidenceEnvelope;

    const checks: VerificationReport['checks'] = {
      payloadHash: { ok: true },
      chainHash: { ok: true },
      genesisIfFirst: { ok: true },
      timestamps: [],
    };

    // 1. Payload hash
    const recomputedPayloadHash = hashPayload(envelope.event.payload);
    if (recomputedPayloadHash !== envelope.event.payloadHash) {
      checks.payloadHash = {
        ok: false,
        reason: `recomputed=${recomputedPayloadHash}, stored=${envelope.event.payloadHash}`,
      };
    }

    // 2. Chain hash recomputation
    const expectedChainHash = computeChainHash({
      seq: envelope.event.seq,
      tenantId: envelope.event.tenantId,
      payloadHash: envelope.event.payloadHash,
      prevHash: envelope.event.prevHash,
      createdAt: envelope.event.createdAt,
    });
    if (expectedChainHash !== envelope.event.chainHash) {
      checks.chainHash = {
        ok: false,
        reason: `recomputed=${expectedChainHash}, stored=${envelope.event.chainHash}`,
      };
    }

    // 3. Genesis constraint (only meaningful if seq=1)
    if (envelope.event.seq === 1 && envelope.event.prevHash !== GENESIS_PREV_HASH) {
      checks.genesisIfFirst = {
        ok: false,
        reason: `seq=1 must have prevHash=${GENESIS_PREV_HASH}, got ${envelope.event.prevHash}`,
      };
    }

    // 4. TSA tokens
    for (const t of envelope.timestamps) {
      const providerCheck: VerificationReport['checks']['timestamps'][number] = {
        provider: t.provider,
        digestMatchesPayload:
          t.digestHex === envelope.event.payloadHash
            ? { ok: true }
            : {
                ok: false,
                reason: `digest=${t.digestHex} but payloadHash=${envelope.event.payloadHash}`,
              },
        providerVerification: { ok: false, reason: 'no-verifier-available' },
      };
      const provider = this.providers.get(t.provider);
      if (provider) {
        const tokenBytes = Buffer.from(t.tokenBase64, 'base64');
        const result = await provider.verifyToken(
          {
            token: tokenBytes,
            issuedAt: t.issuedAt,
            hashAlgorithm: 'sha-256',
            digestHex: t.digestHex,
            provider: provider.id,
          },
          envelope.event.payloadHash,
        );
        providerCheck.providerVerification = result.ok
          ? { ok: true }
          : { ok: false, reason: `${result.reason}: ${result.detail}` };
      }
      checks.timestamps.push(providerCheck);
    }

    const ok =
      checks.payloadHash.ok &&
      checks.chainHash.ok &&
      checks.genesisIfFirst.ok &&
      checks.timestamps.every(
        (t) => t.digestMatchesPayload.ok && (t.providerVerification.ok || t.providerVerification.reason === 'no-verifier-available'),
      );

    return { ok, envelopeSha256, checks };
  }

  /**
   * Verify a contiguous chain by passing an array of envelopes (or just their
   * event sections, which is what the public verification endpoint returns).
   */
  verifyChainOfEnvelopes(envelopes: EvidenceEnvelope[]): ReturnType<typeof verifyChain> {
    if (envelopes.length === 0) return { ok: true, verified: 0 };
    const tenantId = envelopes[0].event.tenantId;
    const records: ChainRecord[] = envelopes.map((e) => ({
      seq: e.event.seq,
      tenantId: e.event.tenantId,
      payloadHash: e.event.payloadHash,
      prevHash: e.event.prevHash,
      chainHash: e.event.chainHash,
      createdAt: e.event.createdAt,
    }));
    return verifyChain(records, tenantId);
  }
}
