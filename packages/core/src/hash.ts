import { createHash } from 'node:crypto';

export const HASH_ALGORITHM = 'sha256';
export const HASH_HEX_LENGTH = 64;
export const GENESIS_PREV_HASH = '0'.repeat(HASH_HEX_LENGTH);

export function sha256Hex(input: string | Buffer): string {
  return createHash(HASH_ALGORITHM).update(input).digest('hex');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export function hashPayload(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}
