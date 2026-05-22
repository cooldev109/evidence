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
  getEventDetail,
  fetchChainForVerification,
} from '../events/repository.js';
import { createApiKey } from '../tenants/repository.js';
import { generateAndPersistReport } from '../reports/service.js';
import {
  createAppUser,
  listAppUsers,
  setAppUserDisabled,
  listCapturesForTenant,
  getCapture,
  AppUserEmailTaken,
} from '../userapp/repository.js';
import { listSignersByCapture } from '../userapp/signers.js';

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
const CreateUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
  name: z.string().max(256).optional(),
});
const DisableUserBody = z.object({ disabled: z.boolean() });

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
  app.post('/admin/v1/login', { schema: { tags: ['admin'], summary: 'Admin login', body: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } } } }, async (req, reply) => {
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
      const detail = await getEventDetail(deps.sql, a.tid, req.params.id);
      if (!detail) {
        reply.status(404);
        return { error: 'not_found' };
      }
      const { payload, timestamps, ...event } = detail;
      return { event, payload, timestamps };
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

  // ---- End users (the people who use the capture app) ----
  app.get('/admin/v1/users', { preHandler: requireAdmin }, async (req) => {
    const a = req.admin!;
    const users = await listAppUsers(deps.sql, a.tid);
    // never expose password hashes
    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        disabledAt: u.disabledAt,
      })),
    };
  });

  app.post('/admin/v1/users', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = CreateUserBody.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'invalid_body', detail: parsed.error.flatten() };
    }
    const a = req.admin!;
    try {
      const user = await createAppUser(deps.sql, {
        tenantId: a.tid,
        email: parsed.data.email,
        password: parsed.data.password,
        name: parsed.data.name,
      });
      await recordAudit(deps.sql, {
        tenantId: a.tid,
        actorEmail: a.email,
        action: 'app_user.create',
        detail: { appUserId: user.id, email: user.email },
      });
      reply.status(201);
      return { user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt } };
    } catch (err) {
      if (err instanceof AppUserEmailTaken) {
        reply.status(409);
        return { error: 'email_taken' };
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/admin/v1/users/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = DisableUserBody.safeParse(req.body);
      if (!parsed.success) {
        reply.status(400);
        return { error: 'invalid_body' };
      }
      const a = req.admin!;
      const ok = await setAppUserDisabled(deps.sql, a.tid, req.params.id, parsed.data.disabled);
      if (!ok) {
        reply.status(404);
        return { error: 'not_found' };
      }
      await recordAudit(deps.sql, {
        tenantId: a.tid,
        actorEmail: a.email,
        action: parsed.data.disabled ? 'app_user.disable' : 'app_user.enable',
        detail: { appUserId: req.params.id },
      });
      return { ok: true };
    },
  );

  // ---- Review end users' captures (photos/videos/audio/ATA) ----
  app.get<{ Querystring: { userId?: string } }>(
    '/admin/v1/captures',
    { preHandler: requireAdmin },
    async (req) => {
      const a = req.admin!;
      const captures = await listCapturesForTenant(deps.sql, a.tid, req.query.userId);
      return { captures };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/admin/v1/captures/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const a = req.admin!;
      const capture = await getCapture(deps.sql, a.tid, req.params.id);
      if (!capture) {
        reply.status(404);
        return { error: 'not_found' };
      }
      const detail = await getEventDetail(deps.sql, a.tid, capture.eventId);
      const signers =
        capture.kind === 'ata'
          ? (await listSignersByCapture(deps.sql, a.tid, capture.id)).map((s) => ({
              name: s.name,
              email: s.email,
              signed: !!s.signedAt,
              signedAt: s.signedAt,
            }))
          : [];
      return { capture, event: detail, signers };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/admin/v1/captures/:id/media',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const a = req.admin!;
      const capture = await getCapture(deps.sql, a.tid, req.params.id);
      if (!capture) {
        reply.status(404);
        return { error: 'not_found' };
      }
      const { body, contentType } = await deps.persistence.getMedia(capture.objectKey);
      reply.header('Content-Type', contentType ?? capture.contentType);
      reply.header('X-Evidence-Sha256', capture.mediaSha256);
      return reply.send(body);
    },
  );

  // ---- Audit log ----
  app.get('/admin/v1/audit', { preHandler: requireAdmin }, async (req) => {
    const a = req.admin!;
    return { events: await listAudit(deps.sql, a.tid) };
  });
}
