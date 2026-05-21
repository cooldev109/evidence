import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { createAdminUser } from './repository.js';

/**
 * CLI: create an admin user for a tenant.
 *   pnpm --filter @evidence/api admin:create-user <tenantId> <email> <password>
 */
async function main(): Promise<void> {
  const [tenantId, email, password] = process.argv.slice(2);
  if (!tenantId || !email || !password) {
    console.error('usage: admin:create-user <tenantId> <email> <password>');
    process.exit(1);
  }
  const cfg = loadConfig();
  const { sql } = createDb({ url: cfg.DATABASE_URL });
  try {
    const u = await createAdminUser(sql, { tenantId, email, password });
    console.warn('Created admin user:');
    console.warn('  id     :', u.id);
    console.warn('  email  :', email);
    console.warn('  tenant :', tenantId);
  } finally {
    await sql.end();
  }
}

void main();
