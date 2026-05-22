// API client for the end-user capture app (Part 1). Uses its own token,
// distinct from the admin panel, so the two sessions never collide.

const TOKEN_KEY = 'evidence_user_token';

export function getUserToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setUserToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearUserToken(): void {
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
  const token = getUserToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    clearUserToken();
    if (!path.endsWith('/login') && window.location.pathname !== '/login') {
      window.location.assign('/login');
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

export interface CaptureGeo {
  lat?: number;
  lng?: number;
  accuracy?: number;
  address?: string;
}
export interface Capture {
  id: string;
  kind: 'photo' | 'video' | 'audio' | 'ata';
  title: string;
  contentType: string;
  sizeBytes: number;
  mediaSha256: string;
  objectKey: string;
  geo: CaptureGeo | null;
  capturedAt: string;
  createdAt: string;
  eventId: string;
  transcript: string | null;
}
export interface EventTimestamp {
  provider: string;
  jurisdiction: string;
  issuedAt: string;
  digestHex: string;
}
export interface OwnerSigner {
  id: string;
  name: string;
  email: string;
  signed: boolean;
  signedAt: string | null;
  signUrl: string;
}
export interface CaptureDetail {
  capture: Capture;
  event: {
    seq: number;
    payloadHash: string;
    prevHash: string;
    chainHash: string;
    createdAt: string;
    payload: unknown;
    timestamps: EventTimestamp[];
  } | null;
  signers: OwnerSigner[];
}
export interface MeUser {
  id: string;
  email: string;
  name: string;
  tenant: { slug: string; name: string; locale: string } | null;
}

export const userApi = {
  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; email: string; name: string; tenantId: string } }>(
      'POST',
      '/app/v1/login',
      { email, password },
    ),
  me: () => request<MeUser>('GET', '/app/v1/me'),
  captures: () => request<{ captures: Capture[] }>('GET', '/app/v1/captures'),
  capture: (id: string) => request<CaptureDetail>('GET', `/app/v1/captures/${id}`),
};

export interface UploadFields {
  kind: Capture['kind'];
  title: string;
  capturedAt: string;
  geo: CaptureGeo | null;
}

/** Upload a capture (multipart). Returns the created capture + evidence refs. */
export async function uploadCapture(
  file: Blob,
  filename: string,
  fields: UploadFields,
): Promise<{ capture: Capture }> {
  const form = new FormData();
  form.append('kind', fields.kind);
  form.append('title', fields.title);
  form.append('capturedAt', fields.capturedAt);
  if (fields.geo) form.append('geo', JSON.stringify(fields.geo));
  form.append('file', file, filename);
  const res = await fetch('/app/v1/captures', {
    method: 'POST',
    headers: { authorization: `Bearer ${getUserToken()}` },
    body: form,
  });
  if (res.status === 401) {
    clearUserToken();
    window.location.assign('/login');
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
  return (await res.json()) as { capture: Capture };
}

export interface AtaParticipant {
  name?: string;
  email?: string;
}

/** Upload an ATA recording: server transcribes, seals, and timestamps it. */
export async function uploadAta(
  audio: Blob,
  filename: string,
  fields: { title: string; capturedAt: string; geo: CaptureGeo | null; language?: string; participants: AtaParticipant[] },
): Promise<{ capture: Capture; transcript: string }> {
  const form = new FormData();
  form.append('title', fields.title);
  form.append('capturedAt', fields.capturedAt);
  if (fields.geo) form.append('geo', JSON.stringify(fields.geo));
  if (fields.language) form.append('language', fields.language);
  if (fields.participants.length) form.append('participants', JSON.stringify(fields.participants));
  form.append('file', audio, filename);
  const res = await fetch('/app/v1/ata', {
    method: 'POST',
    headers: { authorization: `Bearer ${getUserToken()}` },
    body: form,
  });
  if (res.status === 401) {
    clearUserToken();
    window.location.assign('/login');
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
  return (await res.json()) as { capture: Capture; transcript: string };
}

export function mediaUrl(captureId: string): string {
  return `/app/v1/captures/${captureId}/media`;
}

// ---- Public ATA signing (no authentication) ----
export interface AtaSignView {
  signed: boolean;
  signer: { name: string; email: string; signedAt: string | null };
  ata: {
    title: string;
    transcript: string | null;
    capturedAt: string;
    geo: CaptureGeo | null;
    organization: string | null;
  } | null;
}

export async function getAtaForSigning(token: string): Promise<AtaSignView> {
  const res = await fetch(`/public/v1/ata/sign/${token}`);
  if (!res.ok) throw new ApiError(res.status, null);
  return (await res.json()) as AtaSignView;
}

export async function signAta(
  token: string,
  name: string,
): Promise<{ signed: boolean; signedAt: string }> {
  const res = await fetch(`/public/v1/ata/sign/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new ApiError(res.status, null);
  return (await res.json()) as { signed: boolean; signedAt: string };
}
