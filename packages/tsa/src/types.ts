/**
 * Provider-agnostic RFC 3161 Timestamp Authority abstraction.
 *
 * EVIDENCE supports plugging in multiple TSAs (ICP-Brasil, eIDAS-qualified,
 * US-anchored, or development-only providers like FreeTSA). The provider
 * is selected per request based on the tenant locale, with override.
 */

export type ProviderId =
  | 'mock'
  | 'freetsa'
  | 'icp-brasil'
  | 'eidas'
  | 'us-digicert'
  | 'us-globalsign';

export type Jurisdiction = 'BR' | 'EU' | 'US' | 'DEV';

export interface TimestampToken {
  /** RFC 3161 token bytes (DER-encoded). For the mock provider this is a stable synthetic payload. */
  token: Buffer;
  /** Wall-clock time the TSA asserts the digest existed. */
  issuedAt: string;
  /** Hash algorithm the TSA acknowledged (always sha-256 for v1). */
  hashAlgorithm: 'sha-256';
  /** The digest that was timestamped. */
  digestHex: string;
  /** Which provider issued the token. */
  provider: ProviderId;
}

export interface TokenVerificationOk {
  ok: true;
  provider: ProviderId;
  issuedAt: string;
  digestHex: string;
}

export interface TokenVerificationErr {
  ok: false;
  provider: ProviderId;
  reason:
    | 'digest-mismatch'
    | 'malformed-token'
    | 'signature-invalid'
    | 'cert-chain-invalid'
    | 'provider-error';
  detail: string;
}

export type TokenVerification = TokenVerificationOk | TokenVerificationErr;

export interface TSAProvider {
  readonly id: ProviderId;
  readonly jurisdictions: ReadonlyArray<Jurisdiction>;
  requestToken(digestHex: string): Promise<TimestampToken>;
  verifyToken(token: TimestampToken, expectedDigestHex: string): Promise<TokenVerification>;
}

export class TSAError extends Error {
  constructor(
    public readonly provider: ProviderId,
    public readonly code: 'not-configured' | 'request-failed' | 'invalid-response',
    message: string,
  ) {
    super(`[${provider}] ${code}: ${message}`);
  }
}
