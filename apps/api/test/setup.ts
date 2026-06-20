import postgres from 'postgres';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/db/migrate.js';
import { createDb, type PgClient, type Database } from '../src/db/client.js';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { LocalFilesystemStore } from '@evidence/storage';
import { MockTSAProvider, buildRegistry } from '@evidence/tsa';
import { EvidencePersistenceService } from '../src/evidence/persistence-service.js';
import { MockTranscriber } from '../src/transcription/index.js';
import { NoopCtiClient } from '../src/cti/index.js';
import type { FastifyInstance } from 'fastify';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://evidence:evidence@localhost:5432/evidence';

export interface TestContext {
  app: FastifyInstance;
  sql: PgClient;
  db: Database;
  storeDir: string;
  close: () => Promise<void>;
}

export async function setupTestContext(): Promise<TestContext> {
  await runMigrations(TEST_DATABASE_URL);
  const { sql, db } = createDb({ url: TEST_DATABASE_URL });
  const storeDir = await mkdtemp(join(tmpdir(), 'evidence-test-store-'));
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    LOG_LEVEL: 'error',
    NODE_ENV: 'test',
    WEBHOOK_HMAC_SECRET: 'test-secret-1234',
    STORAGE_BACKEND: 'local',
    STORAGE_LOCAL_DIR: storeDir,
    RETAIN_MODE: 'governance',
    RETAIN_YEARS: '5',
    TSA_DEFAULT_PROVIDER: 'mock',
    TSA_BR_PROVIDER: 'mock',
    TSA_EU_PROVIDER: 'mock',
    TSA_US_PROVIDER: 'mock',
    // Force the SPA to be unmounted in tests so / serves API metadata
    // deterministically (independent of whether the admin was built).
    ADMIN_DIST_PATH: '/nonexistent-admin-dist',
  });
  const store = new LocalFilesystemStore(storeDir);
  const tsaRegistry = buildRegistry([new MockTSAProvider()], {
    DEV: 'mock',
    BR: 'mock',
    EU: 'mock',
    US: 'mock',
  });
  const cti = new NoopCtiClient({
    info: () => {}, warn: () => {}, error: () => {},
  });
  const persistence = new EvidencePersistenceService({ sql, store, tsaRegistry, cti });
  const app = await buildServer({
    config,
    sql,
    persistence,
    transcriber: new MockTranscriber(),
    cti,
  });
  await app.ready();
  return {
    app,
    sql,
    db,
    storeDir,
    close: async () => {
      await app.close();
      await sql.end();
      await rm(storeDir, { recursive: true, force: true });
    },
  };
}

export async function resetDb(): Promise<void> {
  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`TRUNCATE TABLE events, tenant_chain_tips, api_keys, tenants, event_timestamps, evidence_objects, tenant_settings, reports, admin_users, audit_events, app_users, captures, ata_signers RESTART IDENTITY CASCADE`;
  } finally {
    await sql.end();
  }
}
