import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { loadConfig } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function ensureMigrationsTable(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function applied(sql: postgres.Sql): Promise<Set<string>> {
  const rows = await sql<{ name: string }[]>`SELECT name FROM _migrations`;
  return new Set(rows.map((r) => r.name));
}

export async function runMigrations(databaseUrl: string): Promise<{ applied: string[] }> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const newlyApplied: string[] = [];
  try {
    await ensureMigrationsTable(sql);
    const done = await applied(sql);
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const body = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO _migrations(name) VALUES (${file})`;
      });
      newlyApplied.push(file);
    }
  } finally {
    await sql.end();
  }
  return { applied: newlyApplied };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  runMigrations(cfg.DATABASE_URL)
    .then((r) => {
      if (r.applied.length === 0) {
        console.warn('[migrate] no new migrations');
      } else {
        console.warn('[migrate] applied:', r.applied.join(', '));
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrate] failed:', err);
      process.exit(1);
    });
}
