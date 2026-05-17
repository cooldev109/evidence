import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type DbConnectionOptions = {
  url: string;
  max?: number;
};

export type Database = ReturnType<typeof drizzle<typeof schema>>;
export type PgClient = ReturnType<typeof postgres>;

export function createDb(opts: DbConnectionOptions): { db: Database; sql: PgClient } {
  const sql = postgres(opts.url, {
    max: opts.max ?? 10,
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return { db, sql };
}
