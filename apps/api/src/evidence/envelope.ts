import { canonicalJson, sha256Hex } from '@evidence/core';
import type { AppendedEvent } from '../events/repository.js';

/**
 * The canonical evidence envelope is the byte blob written to immutable
 * storage. It contains everything a third party needs to independently
 * verify the event's authenticity and chain placement.
 *
 * Format is JSON for portability and to allow human inspection in tools
 * like jq. Fields are sorted to guarantee byte-identical serialization
 * across runs (chain integrity depends on this).
 */
export interface EvidenceEnvelope {
  version: 1;
  event: {
    id: string;
    tenantId: string;
    seq: number;
    source: string;
    externalId: string | null;
    payload: unknown;
    payloadHash: string;
    prevHash: string;
    chainHash: string;
    createdAt: string;
  };
  timestamps: Array<{
    provider: string;
    jurisdiction: string;
    issuedAt: string;
    digestHex: string;
    tokenBase64: string;
  }>;
}

export interface BuildEnvelopeInput {
  event: AppendedEvent;
  payload: unknown;
  timestamps: EvidenceEnvelope['timestamps'];
}

export function buildEnvelope(input: BuildEnvelopeInput): Buffer {
  const envelope: EvidenceEnvelope = {
    version: 1,
    event: {
      id: input.event.id,
      tenantId: input.event.tenantId,
      seq: input.event.seq,
      source: input.event.source,
      externalId: input.event.externalId,
      payload: input.payload,
      payloadHash: input.event.payloadHash,
      prevHash: input.event.prevHash,
      chainHash: input.event.chainHash,
      createdAt: input.event.createdAt,
    },
    timestamps: input.timestamps,
  };
  return Buffer.from(canonicalJson(envelope), 'utf8');
}

export function digestEnvelope(body: Buffer): string {
  return sha256Hex(body);
}
