import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal HS256 JWT (sign + verify) using Node crypto — no external dep.
 * Tokens carry the admin user id, tenant id, and email.
 */

export interface AdminClaims {
  sub: string; // admin user id
  tid: string; // tenant id
  email: string;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signAdminToken(
  payload: Omit<AdminClaims, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds = 60 * 60 * 12,
): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: AdminClaims = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const data = `${header}.${body}`;
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyAdminToken(token: string, secret: string): AdminClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const expected = createHmac('sha256', secret).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  let claims: AdminClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AdminClaims;
  } catch {
    return null;
  }
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}
