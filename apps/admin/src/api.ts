const TOKEN_KEY = 'evidence_admin_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    clearToken();
    if (!path.endsWith('/login') && window.location.pathname !== '/admin/login') {
      window.location.assign('/admin/login');
    }
  }
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, parsed);
  }
  return (await res.json()) as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; email: string; tenantId: string } }>(
      'POST',
      '/admin/v1/login',
      { email, password },
    ),
  me: () => request<{ id: string; email: string; tenantId: string; tenant: Tenant }>('GET', '/admin/v1/me'),
  overview: () => request<Overview>('GET', '/admin/v1/overview'),
  events: (cursor?: number, limit = 25) =>
    request<{ events: EventRow[]; nextCursor: number | null }>(
      'GET',
      `/admin/v1/events?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
    ),
  event: (id: string) =>
    request<{ event: EventRow; payload: unknown; timestamps: EventTimestamp[] }>(
      'GET',
      `/admin/v1/events/${id}`,
    ),
  apiKeys: () => request<{ keys: ApiKey[] }>('GET', '/admin/v1/api-keys'),
  createKey: (label: string) =>
    request<{ id: string; key: string }>('POST', '/admin/v1/api-keys', { label }),
  revokeKey: (id: string) => request<{ revoked: boolean }>('DELETE', `/admin/v1/api-keys/${id}`),
  settings: () => request<{ tenant: Tenant; supportedLocales: string[] }>('GET', '/admin/v1/settings'),
  saveSettings: (patch: { locale?: string; cnpj?: string | null }) =>
    request<{ tenant: Tenant }>('PATCH', '/admin/v1/settings', patch),
  audit: () => request<{ events: AuditRow[] }>('GET', '/admin/v1/audit'),
  users: () => request<{ users: AppUserRow[] }>('GET', '/admin/v1/users'),
  createUser: (email: string, password: string, name: string) =>
    request<{ user: AppUserRow }>('POST', '/admin/v1/users', { email, password, name }),
  setUserDisabled: (id: string, disabled: boolean) =>
    request<{ ok: boolean }>('PATCH', `/admin/v1/users/${id}`, { disabled }),
  captures: (userId?: string) =>
    request<{ captures: CaptureRow[] }>(
      'GET',
      `/admin/v1/captures${userId ? `?userId=${userId}` : ''}`,
    ),
  capture: (id: string) =>
    request<{
      capture: CaptureRow;
      event: { payload: unknown; timestamps: EventTimestamp[] } | null;
      signers: AdminSigner[];
    }>('GET', `/admin/v1/captures/${id}`),
};

export async function downloadReport(locale: string): Promise<void> {
  const res = await fetch('/admin/v1/reports', {
    method: 'POST',
    headers: { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ locale }),
  });
  if (!res.ok) throw new ApiError(res.status, null);
  const blob = await res.blob();
  const reportId = res.headers.get('x-evidence-report-id') ?? 'report';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `evidence-${reportId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export interface Tenant {
  slug: string;
  name: string;
  locale: string;
  cnpj: string | null;
}
export interface Overview {
  tenant: Tenant;
  eventCount: number;
  lastSeq: number;
  chain: { ok: boolean; reason?: string; atSeq?: number; verified?: number };
  apiKeyCount: number;
}
export interface EventRow {
  id: string;
  seq: number;
  source: string;
  createdAt: string;
  payloadHash: string;
  prevHash: string;
  chainHash: string;
}
export interface EventTimestamp {
  provider: string;
  jurisdiction: string;
  issuedAt: string;
  digestHex: string;
}
export interface ApiKey {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
}
export interface AuditRow {
  id: string;
  actorEmail: string;
  action: string;
  detail: unknown;
  createdAt: string;
}
export interface AppUserRow {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastLoginAt: string | null;
  disabledAt: string | null;
}
export interface CaptureRow {
  id: string;
  appUserId: string;
  eventId: string;
  kind: 'photo' | 'video' | 'audio' | 'ata';
  title: string;
  contentType: string;
  sizeBytes: number;
  mediaSha256: string;
  geo: { lat?: number; lng?: number; accuracy?: number; address?: string } | null;
  capturedAt: string;
  createdAt: string;
  transcript: string | null;
}
export interface AdminSigner {
  name: string;
  email: string;
  signed: boolean;
  signedAt: string | null;
}
