import { loadConfig } from '../config.js';
import { createDb } from './client.js';
import { createApiKey, createTenant } from '../tenants/repository.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { sql } = createDb({ url: cfg.DATABASE_URL });
  try {
    const tenant = await createTenant(sql, {
      slug: `demo-${Date.now()}`,
      name: 'Demo Tenant',
      locale: 'pt-BR',
    });
    const key = await createApiKey(sql, tenant.id, 'dev');
    console.warn('Seeded tenant:');
    console.warn('  id   :', tenant.id);
    console.warn('  slug :', tenant.slug);
    console.warn('  name :', tenant.name);
    console.warn('  key  :', key.plaintext);
    console.warn('');
    console.warn('Test it:');
    console.warn(
      `  curl -X POST http://localhost:3000/v1/events \\\n    -H 'Authorization: Bearer ${key.plaintext}' \\\n    -H 'Content-Type: application/json' \\\n    -d '{"source":"test","payload":{"hello":"world"}}'`,
    );
  } finally {
    await sql.end();
  }
}

void main();
