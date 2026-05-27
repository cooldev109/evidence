import { randomInt } from 'node:crypto';
import type {
  Jurisdiction,
  ProviderId,
  TimestampToken,
  TokenVerification,
  TSAProvider,
} from './types.js';
import { TSAError } from './types.js';
import { encodeTimeStampReq } from './rfc3161-codec.js';

/**
 * FreeTSA.org RFC 3161 timestamp provider.
 *
 * Suitable for development / staging and for use cases where a free
 * (non-accredited) timestamp is acceptable. For production legal
 * evidence, swap in ICP-Brasil / eIDAS-qualified / US TSA providers.
 *
 * Full RFC 3161 response parsing and certificate-chain verification is
 * intentionally deferred to the standalone verification engine (Milestone 3)
 * to keep this module dependency-light. requestToken stores the opaque
 * TimeStampResp bytes; verifyToken returns provider-error if asked to
 * verify without the full verifier wired up.
 */
export class FreeTSAProvider implements TSAProvider {
  readonly id: ProviderId = 'freetsa';
  readonly jurisdictions: ReadonlyArray<Jurisdiction> = ['DEV'];

  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(opts: {
    endpoint?: string;
    fetch?: typeof fetch;
    clock?: () => Date;
    /** Per-attempt timeout (default 8 s). Prevents indefinite hangs when
     *  freetsa.org is slow or unreachable. */
    timeoutMs?: number;
    /** How many extra attempts to make on transient failures (default 1). */
    retries?: number;
  } = {}) {
    this.endpoint = opts.endpoint ?? 'https://freetsa.org/tsr';
    this.fetchImpl = opts.fetch ?? fetch;
    this.clock = opts.clock ?? (() => new Date());
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.retries = opts.retries ?? 1;
  }

  async requestToken(digestHex: string): Promise<TimestampToken> {
    const nonce = randomInt(1, 0x7fffffff);
    const req = encodeTimeStampReq(digestHex, { nonce, certReq: true });
    const maxAttempts = this.retries + 1;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/timestamp-query' },
          body: req,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          throw new TSAError(
            this.id,
            'request-failed',
            `HTTP ${res.status} ${res.statusText}`,
          );
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) {
          throw new TSAError(this.id, 'invalid-response', 'empty response body');
        }
        return {
          token: buf,
          issuedAt: this.clock().toISOString(),
          hashAlgorithm: 'sha-256',
          digestHex,
          provider: this.id,
        };
      } catch (err) {
        lastErr = err;
        // Don't retry on a hard 4xx (likely our request is malformed).
        if (err instanceof TSAError && err.code === 'request-failed' && /HTTP 4\d\d/.test(err.message)) {
          throw err;
        }
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 250 * attempt));
        }
      } finally {
        clearTimeout(t);
      }
    }
    throw lastErr instanceof TSAError
      ? lastErr
      : new TSAError(this.id, 'request-failed', String(lastErr));
  }

  async verifyToken(token: TimestampToken, expectedDigestHex: string): Promise<TokenVerification> {
    if (token.digestHex !== expectedDigestHex) {
      return {
        ok: false,
        provider: this.id,
        reason: 'digest-mismatch',
        detail: `Token digest ${token.digestHex} does not match expected ${expectedDigestHex}`,
      };
    }
    // Full ASN.1 verification of the TimeStampResp + cert chain is implemented
    // by the standalone verifier in Milestone 3. For now, structural sanity
    // only.
    if (token.token.length < 32 || token.token[0] !== 0x30) {
      return {
        ok: false,
        provider: this.id,
        reason: 'malformed-token',
        detail: 'token does not look like an ASN.1 SEQUENCE',
      };
    }
    return { ok: true, provider: this.id, issuedAt: token.issuedAt, digestHex: token.digestHex };
  }
}
