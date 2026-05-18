import type {
  Jurisdiction,
  ProviderId,
  TimestampToken,
  TokenVerification,
  TSAProvider,
} from './types.js';
import { TSAError } from './types.js';

/**
 * Skeleton implementations of jurisdiction-specific providers. Each one
 * advertises its jurisdiction and ID so the selector wires them in, but
 * raises a clear "not configured" error until credentials are provisioned.
 *
 * Wiring the real protocol is identical to the FreeTSA flow (RFC 3161
 * over HTTPS); the difference is the endpoint URL and authentication
 * (typically a client TLS cert or a bearer token issued by the TSA).
 */

abstract class StubProvider implements TSAProvider {
  abstract readonly id: ProviderId;
  abstract readonly jurisdictions: ReadonlyArray<Jurisdiction>;

  async requestToken(_digestHex: string): Promise<TimestampToken> {
    throw new TSAError(
      this.id,
      'not-configured',
      `${this.id} provider is not configured for this environment. Provision credentials and replace the stub.`,
    );
  }

  async verifyToken(_t: TimestampToken, _d: string): Promise<TokenVerification> {
    return {
      ok: false,
      provider: this.id,
      reason: 'provider-error',
      detail: `${this.id} verification not configured`,
    };
  }
}

export class ICPBrasilProvider extends StubProvider {
  readonly id: ProviderId = 'icp-brasil';
  readonly jurisdictions: ReadonlyArray<Jurisdiction> = ['BR'];
}

export class EIDASProvider extends StubProvider {
  readonly id: ProviderId = 'eidas';
  readonly jurisdictions: ReadonlyArray<Jurisdiction> = ['EU'];
}

export class USDigicertProvider extends StubProvider {
  readonly id: ProviderId = 'us-digicert';
  readonly jurisdictions: ReadonlyArray<Jurisdiction> = ['US'];
}
