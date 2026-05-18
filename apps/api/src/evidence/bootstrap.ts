import {
  buildRegistry,
  EIDASProvider,
  FreeTSAProvider,
  ICPBrasilProvider,
  MockTSAProvider,
  USDigicertProvider,
  type ProviderId,
  type TSAProvider,
  type TSARegistry,
} from '@evidence/tsa';
import {
  LocalFilesystemStore,
  S3ObjectLockStore,
  type EvidenceStore,
} from '@evidence/storage';
import type { AppConfig } from '../config.js';

export function buildTSARegistry(cfg: AppConfig): TSARegistry {
  const providers: TSAProvider[] = [
    new MockTSAProvider(),
    new FreeTSAProvider(),
    new ICPBrasilProvider(),
    new EIDASProvider(),
    new USDigicertProvider(),
  ];
  const defaults: Partial<Record<'BR' | 'EU' | 'US' | 'DEV', ProviderId>> = {
    DEV: cfg.TSA_DEFAULT_PROVIDER,
    BR: cfg.TSA_BR_PROVIDER,
    EU: cfg.TSA_EU_PROVIDER,
    US: cfg.TSA_US_PROVIDER,
  };
  return buildRegistry(providers, defaults);
}

export function buildStore(cfg: AppConfig): EvidenceStore {
  if (cfg.STORAGE_BACKEND === 's3') {
    if (!cfg.STORAGE_S3_BUCKET) {
      throw new Error('STORAGE_BACKEND=s3 but STORAGE_S3_BUCKET is not set');
    }
    return new S3ObjectLockStore({
      bucket: cfg.STORAGE_S3_BUCKET,
      region: cfg.STORAGE_S3_REGION,
      defaultKmsKeyId: cfg.STORAGE_KMS_KEY_ID,
    });
  }
  return new LocalFilesystemStore(cfg.STORAGE_LOCAL_DIR);
}

export function computeRetainUntil(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString();
}
