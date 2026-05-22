import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256Hex } from '@evidence/core';
import {
  ImmutabilityViolation,
  type EvidenceStore,
  type GetEvidenceResult,
  type HeadEvidenceResult,
  type PutEvidenceInput,
  type PutObjectInput,
  type PutEvidenceResult,
  type RetainMode,
} from './types.js';

interface RetentionManifestEntry {
  retainUntil?: string;
  retainMode: RetainMode;
  sha256: string;
  sizeBytes: number;
  contentType?: string;
  createdAt: string;
}

/**
 * Local-filesystem evidence store. Used for dev and CI.
 *
 * Simulates Object Lock semantics by:
 *   1. Marking written files mode 0o400 (read-only by owner).
 *   2. Writing a sidecar `.retention.json` manifest tracking retainUntil/Mode.
 *   3. Rejecting putEvidence into an existing key (even with a different body).
 *
 * This is not a security boundary — root can override perms — but it's a
 * faithful behavioral simulation for tests and local dev.
 */
export class LocalFilesystemStore implements EvidenceStore {
  readonly id = 'local' as const;
  readonly bucket: string;

  constructor(rootDir: string) {
    this.bucket = rootDir;
  }

  private pathFor(objectKey: string): string {
    return join(this.bucket, objectKey);
  }

  private manifestPath(objectKey: string): string {
    return `${this.pathFor(objectKey)}.retention.json`;
  }

  async putEvidence(input: PutEvidenceInput): Promise<PutEvidenceResult> {
    const objectKey = `${input.tenantId}/${input.eventId}.evd`;
    const target = this.pathFor(objectKey);
    if (existsSync(target)) {
      const manifest = await this.readManifest(objectKey);
      throw new ImmutabilityViolation(objectKey, manifest?.retainUntil ?? 'forever');
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.body, { mode: 0o400 });
    try {
      await chmod(target, 0o400);
    } catch {
      // best effort: some filesystems don't support chmod
    }
    const sha256 = sha256Hex(input.body);
    const retainMode: RetainMode = input.retainMode ?? 'none';
    const manifest: RetentionManifestEntry = {
      retainUntil: input.retainUntil,
      retainMode,
      sha256,
      sizeBytes: input.body.length,
      contentType: input.contentType,
      createdAt: new Date().toISOString(),
    };
    await writeFile(this.manifestPath(objectKey), JSON.stringify(manifest), { mode: 0o400 });
    return {
      store: 'local',
      bucket: this.bucket,
      objectKey,
      sizeBytes: input.body.length,
      sha256,
      retainUntil: input.retainUntil,
      retainMode,
    };
  }

  async getEvidence(objectKey: string): Promise<GetEvidenceResult> {
    const body = await readFile(this.pathFor(objectKey));
    const sha256 = sha256Hex(body);
    const manifest = await this.readManifest(objectKey);
    return {
      body,
      sizeBytes: body.length,
      sha256,
      contentType: manifest?.contentType,
    };
  }

  async putObject(input: PutObjectInput): Promise<PutEvidenceResult> {
    const objectKey = input.objectKey;
    const target = this.pathFor(objectKey);
    if (existsSync(target)) {
      const manifest = await this.readManifest(objectKey);
      throw new ImmutabilityViolation(objectKey, manifest?.retainUntil ?? 'forever');
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.body, { mode: 0o400 });
    try {
      await chmod(target, 0o400);
    } catch {
      /* best effort */
    }
    const sha256 = sha256Hex(input.body);
    const retainMode: RetainMode = input.retainMode ?? 'none';
    const manifest: RetentionManifestEntry = {
      retainUntil: input.retainUntil,
      retainMode,
      sha256,
      sizeBytes: input.body.length,
      contentType: input.contentType,
      createdAt: new Date().toISOString(),
    };
    await writeFile(this.manifestPath(objectKey), JSON.stringify(manifest), { mode: 0o400 });
    return {
      store: 'local',
      bucket: this.bucket,
      objectKey,
      sizeBytes: input.body.length,
      sha256,
      retainUntil: input.retainUntil,
      retainMode,
    };
  }

  async getObject(objectKey: string): Promise<GetEvidenceResult> {
    return this.getEvidence(objectKey);
  }

  async headEvidence(objectKey: string): Promise<HeadEvidenceResult> {
    const target = this.pathFor(objectKey);
    if (!existsSync(target)) {
      return {
        store: 'local',
        bucket: this.bucket,
        objectKey,
        sizeBytes: 0,
        sha256: '',
        retainMode: 'none',
        exists: false,
      };
    }
    const s = await stat(target);
    const manifest = await this.readManifest(objectKey);
    return {
      store: 'local',
      bucket: this.bucket,
      objectKey,
      sizeBytes: s.size,
      sha256: manifest?.sha256 ?? '',
      retainUntil: manifest?.retainUntil,
      retainMode: manifest?.retainMode ?? 'none',
      exists: true,
    };
  }

  private async readManifest(objectKey: string): Promise<RetentionManifestEntry | null> {
    const p = this.manifestPath(objectKey);
    if (!existsSync(p)) return null;
    return JSON.parse(await readFile(p, 'utf8')) as RetentionManifestEntry;
  }
}
