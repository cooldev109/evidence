import { describe, it, expect } from 'vitest';
import { MockTSAProvider } from './mock-provider.js';
import { encodeTimeStampReq } from './rfc3161-codec.js';
import {
  buildRegistry,
  localeToJurisdiction,
  pickProvider,
} from './selector.js';
import { ICPBrasilProvider, EIDASProvider, USDigicertProvider } from './stub-providers.js';
import { TSAError } from './types.js';

const DIGEST = 'a'.repeat(64);

describe('MockTSAProvider', () => {
  it('round-trips a token', async () => {
    const fixedAt = new Date('2026-01-01T00:00:00.000Z');
    const provider = new MockTSAProvider({ clock: () => fixedAt });
    const token = await provider.requestToken(DIGEST);
    expect(token.provider).toBe('mock');
    expect(token.issuedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(token.digestHex).toBe(DIGEST);

    const v = await provider.verifyToken(token, DIGEST);
    expect(v.ok).toBe(true);
  });

  it('rejects a digest mismatch', async () => {
    const provider = new MockTSAProvider();
    const token = await provider.requestToken(DIGEST);
    const v = await provider.verifyToken(token, 'b'.repeat(64));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('digest-mismatch');
  });

  it('rejects a tampered token', async () => {
    const provider = new MockTSAProvider();
    const token = await provider.requestToken(DIGEST);
    token.token[token.token.length - 1] ^= 0x01;
    const v = await provider.verifyToken(token, DIGEST);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('signature-invalid');
  });
});

describe('rfc3161 codec', () => {
  it('emits a TimeStampReq starting with SEQUENCE tag', () => {
    const buf = encodeTimeStampReq(DIGEST, { nonce: 12345, certReq: true });
    expect(buf[0]).toBe(0x30); // ASN.1 SEQUENCE
    expect(buf.length).toBeGreaterThan(40);
  });

  it('rejects digests that are not 32 bytes', () => {
    expect(() => encodeTimeStampReq('aa', {})).toThrow();
  });
});

describe('locale → jurisdiction', () => {
  it.each([
    ['pt-BR', 'BR'],
    ['en-US', 'US'],
    ['es-ES', 'EU'],
    ['de-DE', 'EU'],
    ['xx-ZZ', 'DEV'],
  ] as const)('%s → %s', (locale, j) => {
    expect(localeToJurisdiction(locale)).toBe(j);
  });
});

describe('provider selector', () => {
  it('selects by locale default', () => {
    const mock = new MockTSAProvider();
    const br = new ICPBrasilProvider();
    const eu = new EIDASProvider();
    const us = new USDigicertProvider();
    const reg = buildRegistry([mock, br, eu, us], {
      DEV: 'mock',
      BR: 'icp-brasil',
      EU: 'eidas',
      US: 'us-digicert',
    });
    expect(pickProvider(reg, { locale: 'pt-BR' }).id).toBe('icp-brasil');
    expect(pickProvider(reg, { locale: 'en-US' }).id).toBe('us-digicert');
    expect(pickProvider(reg, { locale: 'es-ES' }).id).toBe('eidas');
    expect(pickProvider(reg, { locale: 'xx-ZZ' }).id).toBe('mock');
  });

  it('honors override', () => {
    const mock = new MockTSAProvider();
    const br = new ICPBrasilProvider();
    const reg = buildRegistry([mock, br], { DEV: 'mock', BR: 'icp-brasil' });
    expect(pickProvider(reg, { locale: 'pt-BR', override: 'mock' }).id).toBe('mock');
  });
});

describe('stub providers', () => {
  it('throws a not-configured error on requestToken', async () => {
    const p = new ICPBrasilProvider();
    await expect(p.requestToken(DIGEST)).rejects.toBeInstanceOf(TSAError);
  });
});
