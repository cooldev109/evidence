import type { AppConfig } from '../config.js';
import type { PgClient } from '../db/client.js';
import { HttpCtiClient, NoopCtiClient, type CtiLogger } from './client.js';
import type { CtiClient } from './types.js';

export type { CtiClient, CtiReport } from './types.js';
export { CtiError } from './types.js';
export { HttpCtiClient, NoopCtiClient, signCtiRequest } from './client.js';

/**
 * Build the right CTI client based on config. If any of the four credential
 * fields is missing, we silently use the noop client so dev/staging keep
 * working — the missing creds are logged at startup so it's not invisible.
 */
export function buildCtiClient(cfg: AppConfig, sql: PgClient, log?: CtiLogger): CtiClient {
  if (!cfg.CTI_BASE_URL || !cfg.CTI_CLIENT_ID || !cfg.CTI_API_KEY || !cfg.CTI_HMAC_SECRET) {
    // eslint-disable-next-line no-console
    console.warn('[cti] credentials not fully configured; using NoopCtiClient');
    return new NoopCtiClient(log);
  }
  return new HttpCtiClient(
    {
      baseUrl: cfg.CTI_BASE_URL,
      clientId: cfg.CTI_CLIENT_ID,
      apiKey: cfg.CTI_API_KEY,
      hmacSecret: cfg.CTI_HMAC_SECRET,
    },
    sql,
    log,
  );
}
