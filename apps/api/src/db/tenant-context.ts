import type { PgClient } from './client.js';

export type TenantTx<T> = (tx: PgClient) => Promise<T>;

/**
 * Run a callback in a transaction that has `evidence.tenant_id` set, so RLS
 * policies apply to every query inside. `set_config(..., true)` is transaction-local.
 */
export async function withTenant<T>(
  sql: PgClient,
  tenantId: string,
  cb: TenantTx<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('evidence.tenant_id', ${tenantId}, true)`;
    return cb(tx as unknown as PgClient);
  }) as Promise<T>;
}
