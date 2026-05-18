import { createHmac } from 'node:crypto';
import type {
  Jurisdiction,
  ProviderId,
  TimestampToken,
  TokenVerification,
  TSAProvider,
} from './types.js';

/**
 * Deterministic in-memory TSA used for tests and local development.
 * The "token" is an HMAC over the digest + issuedAt, so verification is
 * a constant-time HMAC comparison. No network access.
 */
export class MockTSAProvider implements TSAProvider {
  readonly id: ProviderId = 'mock';
  readonly jurisdictions: ReadonlyArray<Jurisdiction> = ['DEV', 'BR', 'EU', 'US'];

  private readonly secret: string;
  private readonly clock: () => Date;

  constructor(opts: { secret?: string; clock?: () => Date } = {}) {
    this.secret = opts.secret ?? 'mock-tsa-secret';
    this.clock = opts.clock ?? (() => new Date());
  }

  async requestToken(digestHex: string): Promise<TimestampToken> {
    const issuedAt = this.clock().toISOString();
    const mac = createHmac('sha256', this.secret)
      .update(`${digestHex}|${issuedAt}|${this.id}`)
      .digest();
    const token = Buffer.concat([
      Buffer.from('MOCKTSA\0', 'utf8'),
      Buffer.from(issuedAt, 'utf8'),
      Buffer.from('|', 'utf8'),
      mac,
    ]);
    return { token, issuedAt, hashAlgorithm: 'sha-256', digestHex, provider: this.id };
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
    const expected = createHmac('sha256', this.secret)
      .update(`${token.digestHex}|${token.issuedAt}|${this.id}`)
      .digest();
    const expectedBuf = Buffer.concat([
      Buffer.from('MOCKTSA\0', 'utf8'),
      Buffer.from(token.issuedAt, 'utf8'),
      Buffer.from('|', 'utf8'),
      expected,
    ]);
    if (
      token.token.length !== expectedBuf.length ||
      !token.token.equals(expectedBuf)
    ) {
      return {
        ok: false,
        provider: this.id,
        reason: 'signature-invalid',
        detail: 'MAC does not match',
      };
    }
    return { ok: true, provider: this.id, issuedAt: token.issuedAt, digestHex: token.digestHex };
  }
}
