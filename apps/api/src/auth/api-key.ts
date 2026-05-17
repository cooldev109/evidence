import { randomBytes } from 'node:crypto';
import { sha256Hex } from '@evidence/core';

export const API_KEY_PREFIX = 'evk_';

export function generateApiKey(): { plaintext: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  const plaintext = `${API_KEY_PREFIX}${raw}`;
  return { plaintext, hash: sha256Hex(plaintext) };
}

export function hashApiKey(plaintext: string): string {
  return sha256Hex(plaintext);
}

export function parseAuthHeader(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  if (!token.startsWith(API_KEY_PREFIX)) return null;
  return token;
}
