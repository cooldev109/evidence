import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type ServerSideEncryption,
} from '@aws-sdk/client-s3';
import { sha256Hex } from '@evidence/core';
import {
  type EvidenceStore,
  type GetEvidenceResult,
  type HeadEvidenceResult,
  type PutEvidenceInput,
  type PutObjectInput,
  type PutEvidenceResult,
  type RetainMode,
} from './types.js';

export interface S3StoreOptions {
  bucket: string;
  client?: S3Client;
  region?: string;
  /** Default KMS key alias/ARN used when input.kmsKeyId is not provided. */
  defaultKmsKeyId?: string;
}

/**
 * Production evidence store: AWS S3 with Object Lock + KMS server-side encryption.
 *
 * The S3 bucket MUST be created with Object Lock enabled at bucket creation
 * time (S3 does not allow enabling it later without a support ticket). The
 * Terraform under infra/aws/ provisions this correctly.
 *
 * Retention is enforced by S3 itself. PutObject uses ObjectLockMode +
 * ObjectLockRetainUntilDate so the object is immutable until the timestamp,
 * regardless of subsequent application logic.
 */
export class S3ObjectLockStore implements EvidenceStore {
  readonly id = 's3' as const;
  readonly bucket: string;
  private readonly client: S3Client;
  private readonly defaultKmsKeyId?: string;

  constructor(opts: S3StoreOptions) {
    this.bucket = opts.bucket;
    this.client = opts.client ?? new S3Client({ region: opts.region });
    this.defaultKmsKeyId = opts.defaultKmsKeyId;
  }

  private keyFor(input: PutEvidenceInput): string {
    return `${input.tenantId}/${input.eventId}.evd`;
  }

  async putEvidence(input: PutEvidenceInput): Promise<PutEvidenceResult> {
    const objectKey = this.keyFor(input);
    const kmsKeyId = input.kmsKeyId ?? this.defaultKmsKeyId;
    const retainMode: RetainMode = input.retainMode ?? 'governance';

    const sse: ServerSideEncryption | undefined = kmsKeyId ? 'aws:kms' : undefined;
    const objectLockMode =
      retainMode === 'compliance'
        ? 'COMPLIANCE'
        : retainMode === 'governance'
          ? 'GOVERNANCE'
          : undefined;

    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Body: input.body,
      ContentType: input.contentType ?? 'application/octet-stream',
      ServerSideEncryption: sse,
      SSEKMSKeyId: kmsKeyId,
      ObjectLockMode: objectLockMode,
      ObjectLockRetainUntilDate: input.retainUntil ? new Date(input.retainUntil) : undefined,
    });
    const res = await this.client.send(cmd);
    return {
      store: 's3',
      bucket: this.bucket,
      objectKey,
      versionId: res.VersionId,
      sizeBytes: input.body.length,
      sha256: sha256Hex(input.body),
      retainUntil: input.retainUntil,
      retainMode,
      kmsKeyId,
    };
  }

  async putObject(input: PutObjectInput): Promise<PutEvidenceResult> {
    const kmsKeyId = input.kmsKeyId ?? this.defaultKmsKeyId;
    const retainMode: RetainMode = input.retainMode ?? 'governance';
    const objectLockMode =
      retainMode === 'compliance' ? 'COMPLIANCE' : retainMode === 'governance' ? 'GOVERNANCE' : undefined;
    const res = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        Body: input.body,
        ContentType: input.contentType ?? 'application/octet-stream',
        ServerSideEncryption: kmsKeyId ? 'aws:kms' : undefined,
        SSEKMSKeyId: kmsKeyId,
        ObjectLockMode: objectLockMode,
        ObjectLockRetainUntilDate: input.retainUntil ? new Date(input.retainUntil) : undefined,
      }),
    );
    return {
      store: 's3',
      bucket: this.bucket,
      objectKey: input.objectKey,
      versionId: res.VersionId,
      sizeBytes: input.body.length,
      sha256: sha256Hex(input.body),
      retainUntil: input.retainUntil,
      retainMode,
      kmsKeyId,
    };
  }

  async getObject(objectKey: string, versionId?: string): Promise<GetEvidenceResult> {
    return this.getEvidence(objectKey, versionId);
  }

  async getEvidence(objectKey: string, versionId?: string): Promise<GetEvidenceResult> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      VersionId: versionId,
    });
    const res = await this.client.send(cmd);
    const chunks: Buffer[] = [];
    if (res.Body) {
      // @ts-expect-error AWS SDK Body is a Node Readable in node runtime
      for await (const chunk of res.Body) {
        chunks.push(Buffer.from(chunk));
      }
    }
    const body = Buffer.concat(chunks);
    return {
      body,
      sizeBytes: body.length,
      sha256: sha256Hex(body),
      contentType: res.ContentType,
    };
  }

  async headEvidence(objectKey: string, versionId?: string): Promise<HeadEvidenceResult> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey, VersionId: versionId }),
      );
      const mode = res.ObjectLockMode;
      const retainMode: RetainMode =
        mode === 'COMPLIANCE' ? 'compliance' : mode === 'GOVERNANCE' ? 'governance' : 'none';
      return {
        store: 's3',
        bucket: this.bucket,
        objectKey,
        versionId: res.VersionId,
        sizeBytes: res.ContentLength ?? 0,
        sha256: res.Metadata?.['x-amz-meta-sha256'] ?? '',
        retainUntil: res.ObjectLockRetainUntilDate?.toISOString(),
        retainMode,
        exists: true,
      };
    } catch (err) {
      const code = (err as { name?: string }).name;
      if (code === 'NotFound' || code === 'NoSuchKey') {
        return {
          store: 's3',
          bucket: this.bucket,
          objectKey,
          sizeBytes: 0,
          sha256: '',
          retainMode: 'none',
          exists: false,
        };
      }
      throw err;
    }
  }
}
