/**
 * Append-only evidence storage abstraction.
 *
 * Production: AWS S3 with Object Lock (Compliance or Governance mode), KMS-SSE.
 * Dev/test: local filesystem implementation that simulates immutability via
 *           POSIX permissions and an on-disk retention manifest.
 *
 * The interface intentionally exposes only the operations the application
 * needs — append-only writes, point-in-time reads, immutability checks.
 * No delete API: removal is governed by the underlying store's retention
 * policy, not by the application.
 */

export type RetainMode = 'compliance' | 'governance' | 'none';

export interface PutEvidenceInput {
  tenantId: string;
  eventId: string;
  body: Buffer;
  /** Optional content-type hint, persisted with the object. */
  contentType?: string;
  /** Object Lock retention window. Required when retainMode != 'none'. */
  retainUntil?: string; // ISO-8601
  retainMode?: RetainMode;
  /** KMS key alias/ARN to encrypt with (S3 only). */
  kmsKeyId?: string;
}

export interface PutEvidenceResult {
  store: 'local' | 's3';
  bucket: string;
  objectKey: string;
  versionId?: string;
  sizeBytes: number;
  sha256: string;
  retainUntil?: string;
  retainMode: RetainMode;
  kmsKeyId?: string;
}

export interface GetEvidenceResult {
  body: Buffer;
  sizeBytes: number;
  sha256: string;
  contentType?: string;
}

export interface HeadEvidenceResult {
  store: 'local' | 's3';
  bucket: string;
  objectKey: string;
  versionId?: string;
  sizeBytes: number;
  sha256: string;
  retainUntil?: string;
  retainMode: RetainMode;
  exists: boolean;
}

export interface PutObjectInput {
  objectKey: string;
  body: Buffer;
  contentType?: string;
  retainUntil?: string;
  retainMode?: RetainMode;
  kmsKeyId?: string;
}

export interface EvidenceStore {
  readonly id: 'local' | 's3';
  putEvidence(input: PutEvidenceInput): Promise<PutEvidenceResult>;
  getEvidence(objectKey: string, versionId?: string): Promise<GetEvidenceResult>;
  headEvidence(objectKey: string, versionId?: string): Promise<HeadEvidenceResult>;
  /** Store an arbitrary object (e.g. a media file) at an explicit key, append-only. */
  putObject(input: PutObjectInput): Promise<PutEvidenceResult>;
  getObject(objectKey: string, versionId?: string): Promise<GetEvidenceResult>;
}

export class ImmutabilityViolation extends Error {
  constructor(public objectKey: string, public until: string) {
    super(`Object ${objectKey} is retained until ${until} and cannot be modified`);
  }
}
