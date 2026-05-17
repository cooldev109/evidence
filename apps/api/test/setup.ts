import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate.js';
import { createDb, type PgClient, type Database } from '../src/db/client.js';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { FastifyInstance } from 'fastify';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://evidence:evidence@localhost:5432/evidence';

export interface TestContext {
  app: FastifyInstance;
  sql: PgClient;
  db: Database;
  close: () => Promise<void>;
}

export async function setupTestContext(): Promise<TestContext> {
  await runMigrations(TEST_DATABASE_URL);
  const { sql, db } = createDb({ url: TEST_DATABASE_URL });
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    LOG_LEVEL: 'error',
    NODE_ENV: 'test',
    WEBHOOK_HMAC_SECRET: 'test-secret-1234',
  });
  const app = await buildServer({ config, sql });
  await app.ready();
  return {
    app,
    sql,
    db,
    close: async () => {
      await app.close();
      await sql.end();
    },
  };
}

export async function resetDb(): Promise<void> {
  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`TRUNCATE TABLE events, tenant_chain_tips, api_keys, tenants RESTART IDENTITY CASCADE`;
  } finally {
    await sql.end();
  }
}
