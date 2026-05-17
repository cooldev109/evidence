import { describe, it, expect } from 'vitest';
import {
  canonicalJson,
  GENESIS_PREV_HASH,
  HASH_HEX_LENGTH,
  hashPayload,
  sha256Hex,
} from './hash.js';

describe('sha256Hex', () => {
  it('produces stable hex digests of the right length', () => {
    const h = sha256Hex('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(h.length).toBe(HASH_HEX_LENGTH);
  });

  it('genesis prev hash is 64 zeros', () => {
    expect(GENESIS_PREV_HASH).toBe('0'.repeat(64));
    expect(GENESIS_PREV_HASH.length).toBe(HASH_HEX_LENGTH);
  });
});

describe('canonicalJson', () => {
  it('sorts object keys recursively for deterministic serialization', () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles primitives and null', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('x')).toBe('"x"');
  });
});

describe('hashPayload', () => {
  it('is order-insensitive for object keys', () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  it('changes if any value changes', () => {
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });
});
