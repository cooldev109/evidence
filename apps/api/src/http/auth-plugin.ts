import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps } from '../server.js';
import { parseAuthHeader } from '../auth/api-key.js';
import { lookupTenantByApiKey, type Tenant } from '../tenants/repository.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: Tenant;
  }
}

export async function registerAuth(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.decorateRequest('tenant', null as unknown as Tenant);

  app.decorate('requireTenant', async (req: FastifyRequest) => {
    const token = parseAuthHeader(req.headers.authorization);
    if (!token) {
      throw app.httpErrors.unauthorized('Missing or malformed Authorization header');
    }
    const tenant = await lookupTenantByApiKey(deps.sql, token);
    if (!tenant) {
      throw app.httpErrors.unauthorized('Invalid API key');
    }
    req.tenant = tenant;
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    requireTenant: (req: FastifyRequest) => Promise<void>;
  }
}
