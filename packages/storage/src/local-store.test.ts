import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFilesystemStore } from './local-store.js';
import { ImmutabilityViolation } from './types.js';

let dir: string;
let store: LocalFilesystemStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'evidence-store-'));
  store = new LocalFilesystemStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('LocalFilesystemStore', () => {
  it('writes and reads an evidence object with sha256', async () => {
    const body = Buffer.from('{"hello":"world"}');
    const put = await store.putEvidence({
      tenantId: 'tenant-a',
      eventId: 'evt-1',
      body,
      contentType: 'application/json',
      retainMode: 'governance',
      retainUntil: '2031-01-01T00:00:00.000Z',
    });
    expect(put.objectKey).toBe('tenant-a/evt-1.evd');
    expect(put.sizeBytes).toBe(body.length);
    expect(put.sha256).toMatch(/^[0-9a-f]{64}$/);

    const got = await store.getEvidence(put.objectKey);
    expect(got.body.equals(body)).toBe(true);
    expect(got.sha256).toBe(put.sha256);
    expect(got.contentType).toBe('application/json');
  });

  it('rejects attempts to overwrite a stored evidence object', async () => {
    const body = Buffer.from('original');
    await store.putEvidence({ tenantId: 't', eventId: 'e', body, retainMode: 'compliance' });
    await expect(
      store.putEvidence({
        tenantId: 't',
        eventId: 'e',
        body: Buffer.from('tampered'),
        retainMode: 'compliance',
      }),
    ).rejects.toBeInstanceOf(ImmutabilityViolation);
  });

  it('head reports retention metadata and existence', async () => {
    const body = Buffer.from('x');
    await store.putEvidence({
      tenantId: 't',
      eventId: 'e',
      body,
      retainMode: 'governance',
      retainUntil: '2030-01-01T00:00:00.000Z',
    });
    const head = await store.headEvidence('t/e.evd');
    expect(head.exists).toBe(true);
    expect(head.retainMode).toBe('governance');
    expect(head.retainUntil).toBe('2030-01-01T00:00:00.000Z');
    expect(head.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('head returns exists=false for unknown keys', async () => {
    const head = await store.headEvidence('nope/missing.evd');
    expect(head.exists).toBe(false);
  });
});
