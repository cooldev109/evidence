import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { setupTestContext, resetDb, type TestContext } from './setup.js';
import { createTenant } from '../src/tenants/repository.js';
import { createAdminUser } from '../src/admin/repository.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb();
});

async function seedTenantWithAdmin(slug = 'ua', locale = 'pt-BR') {
  const tenant = await createTenant(ctx.sql, { slug, name: 'UA Tenant', locale });
  await createAdminUser(ctx.sql, {
    tenantId: tenant.id,
    email: `admin@${slug}.test`,
    password: 'correct-horse',
  });
  return { tenantId: tenant.id, adminEmail: `admin@${slug}.test` };
}

function adminLogin(email: string) {
  return ctx.app.inject({
    method: 'POST',
    url: '/admin/v1/login',
    headers: { 'content-type': 'application/json' },
    payload: { email, password: 'correct-horse' },
  });
}

function authPost(path: string, token: string, body: unknown) {
  return ctx.app.inject({
    method: 'POST',
    url: path,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: body as object,
  });
}
function authGet(path: string, token: string) {
  return ctx.app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${token}` } });
}

/** Build a multipart/form-data body with one file part + text fields. */
function multipart(
  fields: Record<string, string>,
  file: { name: string; filename: string; contentType: string; body: Buffer },
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----evidencetest' + Math.random().toString(36).slice(2);
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
    ),
  );
  chunks.push(file.body);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function registerUser(adminToken: string, email: string, password = 'user-pass-123') {
  return authPost('/admin/v1/users', adminToken, { email, password, name: 'Test User' });
}

async function userLogin(email: string, password = 'user-pass-123') {
  return ctx.app.inject({
    method: 'POST',
    url: '/app/v1/login',
    headers: { 'content-type': 'application/json' },
    payload: { email, password },
  });
}

describe('Admin registers end users', () => {
  it('creates an end user and lists it without exposing the password hash', async () => {
    const { adminEmail } = await seedTenantWithAdmin();
    const adminToken = (await adminLogin(adminEmail)).json().token;

    const created = await registerUser(adminToken, 'paulo@ua.test');
    expect(created.statusCode).toBe(201);
    expect(created.json().user.email).toBe('paulo@ua.test');

    const list = (await authGet('/admin/v1/users', adminToken)).json();
    expect(list.users).toHaveLength(1);
    expect(list.users[0]).not.toHaveProperty('passwordHash');
    expect(list.users[0].email).toBe('paulo@ua.test');
  });

  it('rejects duplicate emails with 409', async () => {
    const { adminEmail } = await seedTenantWithAdmin('dup');
    const adminToken = (await adminLogin(adminEmail)).json().token;
    await registerUser(adminToken, 'dupe@ua.test');
    const again = await registerUser(adminToken, 'dupe@ua.test');
    expect(again.statusCode).toBe(409);
  });

  it('disables a user and blocks their login', async () => {
    const { adminEmail } = await seedTenantWithAdmin('dis');
    const adminToken = (await adminLogin(adminEmail)).json().token;
    const userId = (await registerUser(adminToken, 'blocked@ua.test')).json().user.id;

    expect((await userLogin('blocked@ua.test')).statusCode).toBe(200);

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/admin/v1/users/${userId}`,
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { disabled: true },
    });
    expect(patch.statusCode).toBe(200);
    expect((await userLogin('blocked@ua.test')).statusCode).toBe(401);
  });
});

describe('End-user capture flow', () => {
  it('uploads a photo, seals it on the chain, timestamps it, and lists it in Minhas Provas', async () => {
    const { adminEmail } = await seedTenantWithAdmin('cap');
    const adminToken = (await adminLogin(adminEmail)).json().token;
    await registerUser(adminToken, 'shooter@ua.test');
    const userToken = (await userLogin('shooter@ua.test')).json().token;

    const fileBody = Buffer.from('fake-jpeg-bytes-\x00\x01\x02', 'binary');
    const expectedSha = createHash('sha256').update(fileBody).digest('hex');
    const mp = multipart(
      {
        kind: 'photo',
        title: 'Doorstep delivery',
        capturedAt: '2026-05-22T12:00:00.000Z',
        geo: JSON.stringify({ lat: -23.5, lng: -46.6, accuracy: 12 }),
      },
      { name: 'file', filename: 'photo.jpg', contentType: 'image/jpeg', body: fileBody },
    );
    const up = await ctx.app.inject({
      method: 'POST',
      url: '/app/v1/captures',
      headers: { authorization: `Bearer ${userToken}`, ...mp.headers },
      payload: mp.payload,
    });
    expect(up.statusCode).toBe(201);
    const body = up.json();
    expect(body.capture.kind).toBe('photo');
    expect(body.capture.mediaSha256).toBe(expectedSha);
    expect(body.capture.geo.lat).toBe(-23.5);
    expect(body.event.chainHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.evidence.timestampIds).toHaveLength(1);

    // Minhas Provas
    const provas = (await authGet('/app/v1/captures', userToken)).json();
    expect(provas.captures).toHaveLength(1);
    const captureId = provas.captures[0].id;

    // Detail includes the RFC-3161 timestamp
    const detail = (await authGet(`/app/v1/captures/${captureId}`, userToken)).json();
    expect(detail.event.timestamps).toHaveLength(1);
    expect(detail.event.payload.media.sha256).toBe(expectedSha);

    // Downloaded media bytes round-trip and match the sealed hash
    const media = await authGet(`/app/v1/captures/${captureId}/media`, userToken);
    expect(media.statusCode).toBe(200);
    expect(Buffer.from(media.rawPayload).equals(fileBody)).toBe(true);
    expect(media.headers['x-evidence-sha256']).toBe(expectedSha);
  });

  it('rejects unauthenticated capture uploads', async () => {
    const mp = multipart(
      { kind: 'photo' },
      { name: 'file', filename: 'p.jpg', contentType: 'image/jpeg', body: Buffer.from('x') },
    );
    const up = await ctx.app.inject({
      method: 'POST',
      url: '/app/v1/captures',
      headers: { authorization: 'Bearer not-a-token', ...mp.headers },
      payload: mp.payload,
    });
    expect(up.statusCode).toBe(401);
  });

  it('lets the admin review a user capture and download the media', async () => {
    const { adminEmail } = await seedTenantWithAdmin('review');
    const adminToken = (await adminLogin(adminEmail)).json().token;
    await registerUser(adminToken, 'rev@ua.test');
    const userToken = (await userLogin('rev@ua.test')).json().token;

    const fileBody = Buffer.from('audio-bytes');
    const mp = multipart(
      { kind: 'audio', title: 'Statement' },
      { name: 'file', filename: 'a.weba', contentType: 'audio/webm', body: fileBody },
    );
    await ctx.app.inject({
      method: 'POST',
      url: '/app/v1/captures',
      headers: { authorization: `Bearer ${userToken}`, ...mp.headers },
      payload: mp.payload,
    });

    const adminList = (await authGet('/admin/v1/captures', adminToken)).json();
    expect(adminList.captures).toHaveLength(1);
    const id = adminList.captures[0].id;
    const media = await authGet(`/admin/v1/captures/${id}/media`, adminToken);
    expect(media.statusCode).toBe(200);
    expect(Buffer.from(media.rawPayload).equals(fileBody)).toBe(true);
  });

  it('records an ATA: transcribes the audio, seals + timestamps it, stores the transcript', async () => {
    const { adminEmail } = await seedTenantWithAdmin('ata');
    const adminToken = (await adminLogin(adminEmail)).json().token;
    await registerUser(adminToken, 'scribe@ua.test');
    const userToken = (await userLogin('scribe@ua.test')).json().token;

    const audio = Buffer.from('meeting-audio-bytes');
    const mp = multipart(
      {
        title: 'Reunião de diretoria',
        language: 'pt',
        participants: JSON.stringify([{ name: 'Paulo', email: 'paulo@x.test' }]),
        geo: JSON.stringify({ lat: -23.5, lng: -46.6 }),
      },
      { name: 'file', filename: 'ata.weba', contentType: 'audio/webm', body: audio },
    );
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/app/v1/ata',
      headers: { authorization: `Bearer ${userToken}`, ...mp.headers },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.capture.kind).toBe('ata');
    // MockTranscriber yields deterministic placeholder text.
    expect(body.transcript).toContain('transcrição simulada');
    expect(body.capture.transcript).toBe(body.transcript);
    expect(body.evidence.timestampIds).toHaveLength(1);

    // Transcript + signature status are sealed into the event payload.
    const detail = (
      await authGet(`/app/v1/captures/${body.capture.id}`, userToken)
    ).json();
    expect(detail.event.payload.type).toBe('ata');
    expect(detail.event.payload.transcript).toBe(body.transcript);
    expect(detail.event.payload.signatures.status).toBe('pending');
    expect(detail.event.payload.participants).toHaveLength(1);
  });

  it('lets participants click-to-sign an ATA, sealing each signature on the chain', async () => {
    const { adminEmail } = await seedTenantWithAdmin('sign');
    const adminToken = (await adminLogin(adminEmail)).json().token;
    await registerUser(adminToken, 'host@ua.test');
    const userToken = (await userLogin('host@ua.test')).json().token;

    const mp = multipart(
      {
        title: 'Assembleia',
        participants: JSON.stringify([
          { name: 'Ana', email: 'ana@x.test' },
          { name: 'Bruno', email: 'bruno@x.test' },
        ]),
      },
      { name: 'file', filename: 'ata.weba', contentType: 'audio/webm', body: Buffer.from('aud') },
    );
    const ata = (
      await ctx.app.inject({
        method: 'POST',
        url: '/app/v1/ata',
        headers: { authorization: `Bearer ${userToken}`, ...mp.headers },
        payload: mp.payload,
      })
    ).json();
    expect(ata.signers).toHaveLength(2);
    expect(ata.signers[0].signUrl).toContain('/assinar/');
    expect(ata.signers[0].signed).toBe(false);

    // Extract the first signer's token from the public signing URL.
    const token = ata.signers[0].signUrl.split('/assinar/')[1];

    // Public GET shows the ATA to the (unauthenticated) participant.
    const view = await ctx.app.inject({ method: 'GET', url: `/public/v1/ata/sign/${token}` });
    expect(view.statusCode).toBe(200);
    expect(view.json().signed).toBe(false);
    expect(view.json().ata.title).toBe('Assembleia');

    // Public POST records the signature (no auth).
    const sign = await ctx.app.inject({
      method: 'POST',
      url: `/public/v1/ata/sign/${token}`,
      headers: { 'content-type': 'application/json' },
      payload: { name: 'Ana Maria' },
    });
    expect(sign.statusCode).toBe(200);
    expect(sign.json().signed).toBe(true);
    expect(sign.json().signatureEventId).toBeTruthy();

    // Idempotent: signing again returns the existing signature.
    const again = await ctx.app.inject({
      method: 'POST',
      url: `/public/v1/ata/sign/${token}`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(again.json().alreadySigned).toBe(true);

    // The owner sees one of two signed; the chain stays intact (sig event added).
    const detail = (await authGet(`/app/v1/captures/${ata.capture.id}`, userToken)).json();
    expect(detail.signers).toHaveLength(2);
    expect(detail.signers.filter((s: { signed: boolean }) => s.signed)).toHaveLength(1);

    const verify = (await authGet('/admin/v1/verify', adminToken)).json();
    expect(verify.result.ok).toBe(true);
  });

  it('exposes the captured media via /public/v1/share/<token> with the right SHA-256', async () => {
    const { adminEmail } = await seedTenantWithAdmin('shr');
    const adminToken = (await adminLogin(adminEmail)).json().token;
    await registerUser(adminToken, 'shr@ua.test');
    const userToken = (await userLogin('shr@ua.test')).json().token;

    const fileBytes = Buffer.from('public-share-test');
    const expectedSha = createHash('sha256').update(fileBytes).digest('hex');
    const mp = multipart(
      { kind: 'photo' },
      { name: 'file', filename: 'p.jpg', contentType: 'image/jpeg', body: fileBytes },
    );
    const up = await ctx.app.inject({
      method: 'POST',
      url: '/app/v1/captures',
      headers: { authorization: `Bearer ${userToken}`, ...mp.headers },
      payload: mp.payload,
    });
    expect(up.statusCode).toBe(201);
    const shareToken = up.json().capture.shareToken;
    expect(shareToken).toBeTruthy();

    // Unauthenticated GET via the share token returns the bytes.
    const dl = await ctx.app.inject({ method: 'GET', url: `/public/v1/share/${shareToken}` });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['x-evidence-sha256']).toBe(expectedSha);
    expect(Buffer.from(dl.rawPayload).equals(fileBytes)).toBe(true);

    // Unknown token → 404.
    const nf = await ctx.app.inject({ method: 'GET', url: '/public/v1/share/totally_fake_token' });
    expect(nf.statusCode).toBe(404);
  });

  it('isolates one tenant capture from another admin', async () => {
    const a = await seedTenantWithAdmin('ten-a');
    const b = await seedTenantWithAdmin('ten-b');
    const aAdmin = (await adminLogin(a.adminEmail)).json().token;
    const bAdmin = (await adminLogin(b.adminEmail)).json().token;
    await registerUser(aAdmin, 'a-user@ua.test');
    const aUser = (await userLogin('a-user@ua.test')).json().token;

    const mp = multipart(
      { kind: 'photo' },
      { name: 'file', filename: 'p.jpg', contentType: 'image/jpeg', body: Buffer.from('zz') },
    );
    await ctx.app.inject({
      method: 'POST',
      url: '/app/v1/captures',
      headers: { authorization: `Bearer ${aUser}`, ...mp.headers },
      payload: mp.payload,
    });

    const bList = (await authGet('/admin/v1/captures', bAdmin)).json();
    expect(bList.captures).toHaveLength(0);
  });
});
