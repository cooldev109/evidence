import { hashPayload } from '@evidence/core';
import type { EvidenceStore, RetainMode } from '@evidence/storage';
import {
  MockTSAProvider,
  TSAError,
  localeToJurisdiction,
  pickProvider,
  type TSARegistry,
} from '@evidence/tsa';
import type { PgClient } from '../db/client.js';
import { withTenant } from '../db/tenant-context.js';
import type { AppendedEvent } from '../events/repository.js';
import { buildEnvelope } from './envelope.js';

export interface PersistOptions {
  tenantId: string;
  tenantLocale: string;
  event: AppendedEvent;
  payload: unknown;
  retainMode: RetainMode;
  retainUntilIso: string | null;
  kmsKeyId?: string;
}

export interface PersistenceServiceDeps {
  sql: PgClient;
  store: EvidenceStore;
  tsaRegistry: TSARegistry;
}

export interface PersistResult {
  evidenceObjectId: string;
  storedAt: string;
  objectKey: string;
  bucket: string;
  sha256: string;
  sizeBytes: number;
  timestampIds: string[];
}

/**
 * Coordinates the post-capture pipeline:
 *   1. Request a TSA timestamp on the event's payload hash.
 *   2. Build the canonical evidence envelope.
 *   3. Write the envelope to the immutable store with retention metadata.
 *   4. Persist pointers in event_timestamps + evidence_objects so the
 *      API can answer "show me the proof for this event".
 *
 * Failures are propagated to the caller. A future enhancement should
 * decouple timestamping/storage from the synchronous request path via a
 * background queue, with retries and dead-letter handling.
 */
export class EvidencePersistenceService {
  constructor(private readonly deps: PersistenceServiceDeps) {}

  async persist(opts: PersistOptions): Promise<PersistResult> {
    const { event, tenantId, tenantLocale } = opts;
    const provider = pickProvider(this.deps.tsaRegistry, { locale: tenantLocale });

    // Sanity check: payload hash should match what's already on the event
    const recomputed = hashPayload(opts.payload);
    if (recomputed !== event.payloadHash) {
      throw new Error(
        `Refusing to persist: payload hash mismatch (event=${event.payloadHash}, recomputed=${recomputed})`,
      );
    }

    // Request a timestamp. If the primary TSA is unreachable (e.g. FreeTSA is
    // down, or the VPS can't egress for a moment), fall back to the local
    // MockTSAProvider so the capture still completes. The chain integrity
    // doesn't depend on the TSA — only the legal weight of "this existed by
    // this wall-clock moment" does. Fallback timestamps are tagged with
    // provider='mock-fallback' so admin / re-timestamping tools can find them.
    let token;
    let timestampJurisdiction = localeToJurisdiction(tenantLocale);
    try {
      token = await provider.requestToken(event.payloadHash);
    } catch (err) {
      if (err instanceof TSAError) {
        // eslint-disable-next-line no-console
        console.warn(
          `[persistence] primary TSA '${provider.id}' failed (${err.code}: ${err.message}); using mock-fallback`,
        );
        const fallback = await new MockTSAProvider().requestToken(event.payloadHash);
        token = { ...fallback, provider: 'mock-fallback' as const };
        timestampJurisdiction = 'DEV';
      } else {
        throw err;
      }
    }

    const envelope = buildEnvelope({
      event,
      payload: opts.payload,
      timestamps: [
        {
          provider: token.provider,
          jurisdiction: timestampJurisdiction,
          issuedAt: token.issuedAt,
          digestHex: token.digestHex,
          tokenBase64: token.token.toString('base64'),
        },
      ],
    });

    const put = await this.deps.store.putEvidence({
      tenantId,
      eventId: event.id,
      body: envelope,
      contentType: 'application/json',
      retainMode: opts.retainMode,
      retainUntil: opts.retainUntilIso ?? undefined,
      kmsKeyId: opts.kmsKeyId,
    });

    const now = new Date().toISOString();
    return withTenant(this.deps.sql, tenantId, async (tx) => {
      const tsRows = await tx<{ id: string }[]>`
        INSERT INTO event_timestamps (
          event_id, tenant_id, provider, jurisdiction, token,
          issued_at, digest_hex, created_at
        ) VALUES (
          ${event.id}, ${tenantId}, ${token.provider},
          ${timestampJurisdiction},
          ${token.token},
          ${token.issuedAt}, ${token.digestHex}, ${now}
        )
        RETURNING id
      `;
      const objRows = await tx<{ id: string }[]>`
        INSERT INTO evidence_objects (
          event_id, tenant_id, store, bucket, object_key, version_id,
          size_bytes, sha256, kms_key_id, retain_until, retain_mode, created_at
        ) VALUES (
          ${event.id}, ${tenantId}, ${put.store}, ${put.bucket}, ${put.objectKey},
          ${put.versionId ?? null}, ${put.sizeBytes}, ${put.sha256},
          ${put.kmsKeyId ?? null}, ${put.retainUntil ?? null}, ${put.retainMode}, ${now}
        )
        RETURNING id
      `;
      return {
        evidenceObjectId: objRows[0].id,
        storedAt: now,
        objectKey: put.objectKey,
        bucket: put.bucket,
        sha256: put.sha256,
        sizeBytes: put.sizeBytes,
        timestampIds: tsRows.map((r) => r.id),
      };
    });
  }

  /**
   * Store a raw media file (photo/video/audio/ATA document) at its own key in
   * the immutable store. The file's sha256 is sealed into the chained event's
   * payload and RFC-3161 timestamp, so this object is tamper-evident even
   * though it lives beside the JSON envelope.
   */
  async storeMedia(opts: {
    tenantId: string;
    objectKey: string;
    body: Buffer;
    contentType: string;
    retainMode: RetainMode;
    retainUntilIso: string | null;
    kmsKeyId?: string;
  }): Promise<{ objectKey: string; bucket: string; sha256: string; sizeBytes: number; store: string }> {
    const put = await this.deps.store.putObject({
      objectKey: opts.objectKey,
      body: opts.body,
      contentType: opts.contentType,
      retainMode: opts.retainMode,
      retainUntil: opts.retainUntilIso ?? undefined,
      kmsKeyId: opts.kmsKeyId,
    });
    return {
      objectKey: put.objectKey,
      bucket: put.bucket,
      sha256: put.sha256,
      sizeBytes: put.sizeBytes,
      store: put.store,
    };
  }

  async getMedia(objectKey: string): Promise<{ body: Buffer; contentType?: string }> {
    const got = await this.deps.store.getObject(objectKey);
    return { body: got.body, contentType: got.contentType };
  }

  async getEnvelopeForEvent(
    tenantId: string,
    eventId: string,
  ): Promise<{ envelope: Buffer; meta: PersistResult } | null> {
    return withTenant(this.deps.sql, tenantId, async (tx) => {
      const rows = await tx<
        {
          id: string;
          object_key: string;
          version_id: string | null;
          bucket: string;
          sha256: string;
          size_bytes: string;
          created_at: string;
        }[]
      >`
        SELECT id, object_key, version_id, bucket, sha256, size_bytes, created_at
        FROM evidence_objects
        WHERE tenant_id = ${tenantId} AND event_id = ${eventId}
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      const row = rows[0];
      const got = await this.deps.store.getEvidence(row.object_key, row.version_id ?? undefined);
      return {
        envelope: got.body,
        meta: {
          evidenceObjectId: row.id,
          storedAt: row.created_at,
          objectKey: row.object_key,
          bucket: row.bucket,
          sha256: row.sha256,
          sizeBytes: Number(row.size_bytes),
          timestampIds: [],
        },
      };
    });
  }
}
