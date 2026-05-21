import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyChain } from '@evidence/core';
import { SUPPORTED_LOCALES } from '@evidence/pdf';
import type { AppDeps } from '../server.js';
import { verifyAdminToken, signAdminToken, type AdminClaims } from '../auth/jwt.js';
import { verifyPassword } from '../auth/password.js';
import {
  findAdminByEmail,
  touchLogin,
  recordAudit,
  listAudit,
  listApiKeys,
  revokeApiKey,
  getTenantSettings,
  updateTenantLocale,
} from '../admin/repository.js';
import {
  listEvents,
  getEventById,
  fetchChainForVerification,
} from '../events/repository.js';
import { createApiKey } from '../tenants/repository.js';
import { generateAndPersistReport } from '../reports/service.js';

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminClaims;
  }
}

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const ListQuery = z.object({
  cursor: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const CreateKeyBody = z.object({ label: z.string().min(1).max(128) });
const ReportBody = z.object({
  fromSeq: z.coerce.number().int().min(1).optional(),
  toSeq: z.coerce.number().int().min(1).optional(),
  locale: z.string().optional(),
});
const SettingsBody = z.object({ locale: z.enum(['pt-BR', 'en-US', 'es-ES']) });

export async function registerAdminRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const auth = req.headers.authorization;
    const m = auth ? /^Bearer\s+(.+)$/i.exec(auth) : null;
    const claims = m ? verifyAdminToken(m[1], deps.config.ADMIN_JWT_SECRET) : null;
    if (!claims) {
      reply.status(401).send({ error: 'unauthorized' });
      return;
    }
    req.admin = claims;
  };

  // ---- Login (no auth) ----
  app.post('/admin/v1/login', { schema: { tags: ['admin'], summary: 'Admin login' } }, async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'invalid_body' };
    }
    const user = await findAdminByEmail(deps.sql, parsed.data.email);
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      reply.status(401);
      return { error: 'invalid_credentials' };
    }
    await touchLogin(deps.sql, user.id);
    const token = signAdminToken(
      { sub: user.id, tid: user.tenantId, email: user.email },
      deps.config.ADMIN_JWT_SECRET,
    );
    await recordAudit(deps.sql, {
      tenantId: user.tenantId,
      actorEmail: user.email,
      action: 'login',
    });
    return { token, user: { id: user.id, email: user.email, tenantId: user.tenantId, role: user.role } };
  });

  // ---- Me ----
  app.get('/admin/v1/me', { preHandler: requireAdmin }, async (req) => {
    const a = req.admin!;
    const tenant = await getTenantSettings(deps.sql, a.tid);
    return { id: a.sub, email: a.email, tenantId: a.tid, tenant };
  });

  // ---- Overview / dashboard ----
  app.get('/admin/v1/overview', { preHandler: requireAdmin }, async (req) => {
    const a = req.admin!;
    const events = await fetchChainForVerification(deps.sql, { tenantId: a.tid });
    const chain = verifyChain(
      events.map((e) => ({
        seq: e.seq,
        tenantId: e.tenantId,
        payloadHash: e.payloadHash,
        prevHash: e.prevHash,
        chainHash: e.chainHash,
        createdAt: e.createdAt,
        payload: e.payload,
      })),
      a.tid,
    );
    const keys = await listApiKeys(deps.sql, a.tid);
    const tenant = await getTenantSettings(deps.sql, a.tid);
    return {
      tenant,
      eventCount: events.length,
      lastSeq: events.length ? events[events.length - 1].seq : 0,
      chain,
      apiKeyCount: keys.filter((k) => !k.revokedAt).length,
    };
  });

  // ---- Events ----
  app.get('/admin/v1/events', { preHandler: requireAdmin }, async (req, reply) => {
    const q = ListQuery.safeParse(req.query);
    if (!q.success) {
      reply.status(400);
      return { error: 'invalid_query' };
    }
    const a = req.admin!;
    return listEvents(deps.sql, { tenantId: a.tid, cursor: q.data.cursor, limit: q.data.limit });
  });

  app.get<{ Params: { id: string } }>(
    '/admin/v1/events/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const a = req.admin!;
      const event = await getEventById(deps.sql, a.tid, req.params.id);
      if (!event) {
        reply.status(404);
        return { error: 'not_found' };
      }
      return { event };
    },
  );

  // ---- Verify (chain health) ----
  app.get('/admin/v1/verify', { preHandler: requireAdmin }, async (req) => {
    const a = req.admin!;
    const events = await fetchChainForVerification(deps.sql, { tenantId: a.tid });
    const result = verifyChain(
      events.map((e) => ({
        seq: e.seq,
        tenantId: e.tenantId,
        payloadHash: e.payloadHash,
        prevHash: e.prevHash,
        chainHash: e.chainHash,
        createdAt: e.createdAt,
        payload: e.payload,
      })),
      a.tid,
    );
    return { result };
  });

  // ---- API keys ----
  app.get('/admin/v1/api-keys', { preHandler: requireAdmin }, async (req) => {
    const a = req.admin!;
    return { keys: await listApiKeys(deps.sql, a.tid) };
  });

  app.post('/admin/v1/api-keys', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = CreateKeyBody.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'invalid_body' };
    }
    const a = req.admin!;
    const key = await createApiKey(deps.sql, a.tid, parsed.data.label);
    await recordAudit(deps.sql, {
      tenantId: a.tid,
      actorEmail: a.email,
      action: 'api_key.create',
      detail: { label: parsed.data.label, keyId: key.id },
    });
    // plaintext returned once
    reply.status(201);
    return { id: key.id, key: key.plaintext };
  });

  app.delete<{ Params: { id: string } }>(
    '/admin/v1/api-keys/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const a = req.admin!;
      const ok = await revokeApiKey(deps.sql, a.tid, req.params.id);
      if (!ok) {
        reply.status(404);
        return { error: 'not_found' };
      }
      await recordAudit(deps.sql, {
        tenantId: a.tid,
        actorEmail: a.email,
        action: 'api_key.revoke',
        detail: { keyId: req.params.id },
      });
      return { revoked: true };
    },
  );

  // ---- Reports (PDF export) ----
  app.post('/admin/v1/reports', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = ReportBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.status(400);
      return { error: 'invalid_body' };
    }
    const a = req.admin!;
    const tenant = await getTenantSettings(deps.sql, a.tid);
    if (!tenant) {
      reply.status(404);
      return { error: 'tenant_not_found' };
    }
    const r = await generateAndPersistReport(deps.sql, deps.config, {
      tenant: { id: a.tid, slug: tenant.slug, name: tenant.name, locale: tenant.locale },
      fromSeq: parsed.data.fromSeq,
      toSeq: parsed.data.toSeq,
      locale: parsed.data.locale,
    });
    await recordAudit(deps.sql, {
      tenantId: a.tid,
      actorEmail: a.email,
      action: 'report.generate',
      detail: { reportId: r.reportId, sha256: r.sha256 },
    });
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="evidence-${r.reportId}.pdf"`);
    reply.header('X-Evidence-Report-Id', r.reportId);
    reply.header('X-Evidence-Report-Sha256', r.sha256);
    return reply.send(r.pdf);
  });

  // ---- Settings ----
  app.get('/admin/v1/settings', { preHandler: requireAdmin }, async (req) => {
    const a = req.admin!;
    const tenant = await getTenantSettings(deps.sql, a.tid);
    return { tenant, supportedLocales: SUPPORTED_LOCALES };
  });

  app.patch('/admin/v1/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = SettingsBody.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'invalid_body' };
    }
    const a = req.admin!;
    await updateTenantLocale(deps.sql, a.tid, parsed.data.locale);
    await recordAudit(deps.sql, {
      tenantId: a.tid,
      actorEmail: a.email,
      action: 'settings.update',
      detail: { locale: parsed.data.locale },
    });
    return { tenant: await getTenantSettings(deps.sql, a.tid) };
  });

  // ---- Audit log ----
  app.get('/admin/v1/audit', { preHandler: requireAdmin }, async (req) => {
    const a = req.admin!;
    return { events: await listAudit(deps.sql, a.tid) };
  });
}
