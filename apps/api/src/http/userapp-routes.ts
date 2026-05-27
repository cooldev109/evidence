import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { sha256Hex } from '@evidence/core';
import type { AppDeps } from '../server.js';
import { signUserToken, verifyUserToken, type UserClaims } from '../auth/jwt.js';
import { verifyPassword } from '../auth/password.js';
import { computeRetainUntil } from '../evidence/bootstrap.js';
import { appendEvent, getEventDetail } from '../events/repository.js';
import { getTenantSettings } from '../admin/repository.js';
import {
  findAppUserByEmail,
  findAppUserById,
  touchAppUserLogin,
  recordCapture,
  listCapturesByUser,
  getCapture,
  type CaptureKind,
  type CaptureGeo,
} from '../userapp/repository.js';
import { createAtaSigners, listSignersByCapture, type AtaSigner } from '../userapp/signers.js';
import { buildCertificate } from '../evidence/build-certificate.js';

/** Public signing link for a participant token. */
function signUrl(base: string, token: string): string {
  return `${base.replace(/\/$/, '')}/assinar/${token}`;
}

/** Owner-facing signer view: includes the signing link so it can be shared. */
function signerForOwner(s: AtaSigner, base: string) {
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    signedAt: s.signedAt,
    signed: !!s.signedAt,
    signUrl: signUrl(base, s.token),
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    appUser?: UserClaims;
  }
}

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

const KINDS: CaptureKind[] = ['photo', 'video', 'audio', 'ata'];
// Photos/audio are small; videos can be large. Cap at 200 MB for the
// filesystem store — production video should move to S3/R2 (Object Lock).
const MAX_FILE_BYTES = 200 * 1024 * 1024;

const GeoSchema = z
  .object({
    lat: z.number().optional(),
    lng: z.number().optional(),
    accuracy: z.number().optional(),
    address: z.string().max(512).optional(),
  })
  .strict();

function captureExtension(contentType: string): string {
  // Strip codecs/charset/etc parameters: 'audio/webm;codecs=opus' -> 'audio/webm'.
  const base = contentType.split(';')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heic',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    // iPhone Safari MediaRecorder outputs audio/mp4; Whisper needs the right
    // extension (m4a) to detect the format, otherwise it rejects the upload.
    'audio/mp4': 'm4a',
    'audio/aac': 'm4a',
    'audio/x-m4a': 'm4a',
    // Whisper's accepted-extensions list includes 'webm' but NOT 'weba', and
    // it uses the extension as its primary format hint. Use 'webm' for audio
    // too; the content-type still distinguishes audio from video.
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
    'application/pdf': 'pdf',
  };
  return map[base] ?? 'bin';
}

interface ParsedUpload {
  fileBuf: Buffer | null;
  fileContentType: string;
  truncated: boolean;
  fields: Record<string, string>;
}

/** Read a single-file multipart request into a buffer + text fields. */
async function readUpload(req: FastifyRequest): Promise<ParsedUpload> {
  let fileBuf: Buffer | null = null;
  let fileContentType = 'application/octet-stream';
  let truncated = false;
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      fileContentType = part.mimetype || fileContentType;
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) chunks.push(chunk as Buffer);
      if (part.file.truncated) truncated = true;
      fileBuf = Buffer.concat(chunks);
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { fileBuf, fileContentType, truncated, fields };
}

function parseGeo(raw: string | undefined): CaptureGeo | null {
  if (!raw) return null;
  try {
    const parsed = GeoSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function normalizeCapturedAt(raw: string | undefined): string {
  return raw && !Number.isNaN(Date.parse(raw))
    ? new Date(raw).toISOString()
    : new Date().toISOString();
}

export async function registerUserAppRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES, files: 1 } });

  const requireUser = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const auth = req.headers.authorization;
    const m = auth ? /^Bearer\s+(.+)$/i.exec(auth) : null;
    const claims = m ? verifyUserToken(m[1], deps.config.USER_JWT_SECRET) : null;
    if (!claims) {
      reply.status(401).send({ error: 'unauthorized' });
      return;
    }
    // Reject tokens for users that were disabled after the token was issued.
    const user = await findAppUserById(deps.sql, claims.tid, claims.sub);
    if (!user || user.disabledAt) {
      reply.status(401).send({ error: 'unauthorized' });
      return;
    }
    req.appUser = claims;
  };

  // ---- Login (no auth) ----
  app.post(
    '/app/v1/login',
    {
      schema: {
        tags: ['user-app'],
        summary: 'End-user login',
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const parsed = LoginBody.safeParse(req.body);
      if (!parsed.success) {
        reply.status(400);
        return { error: 'invalid_body' };
      }
      const user = await findAppUserByEmail(deps.sql, parsed.data.email);
      if (!user || user.disabledAt || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
        reply.status(401);
        return { error: 'invalid_credentials' };
      }
      await touchAppUserLogin(deps.sql, user.id);
      const token = signUserToken(
        { sub: user.id, tid: user.tenantId, email: user.email },
        deps.config.USER_JWT_SECRET,
      );
      return {
        token,
        user: { id: user.id, email: user.email, name: user.name, tenantId: user.tenantId },
      };
    },
  );

  // ---- Me ----
  app.get('/app/v1/me', { preHandler: requireUser }, async (req) => {
    const u = req.appUser!;
    const user = await findAppUserById(deps.sql, u.tid, u.sub);
    const tenant = await getTenantSettings(deps.sql, u.tid);
    return {
      id: u.sub,
      email: u.email,
      name: user?.name ?? '',
      tenant,
    };
  });

  // ---- Capture upload (multipart) ----
  // Form fields: kind, title, capturedAt, geo (JSON string), plus one file part.
  app.post(
    '/app/v1/captures',
    {
      preHandler: requireUser,
      schema: {
        tags: ['user-app'],
        summary: 'Upload a capture (photo/video/audio/ATA): sealed + RFC-3161 timestamped',
        consumes: ['multipart/form-data'],
      },
    },
    async (req, reply) => {
      const u = req.appUser!;
      let parsed: ParsedUpload;
      try {
        parsed = await readUpload(req);
      } catch {
        reply.status(400);
        return { error: 'invalid_multipart' };
      }
      const { fileBuf, fileContentType, truncated, fields } = parsed;
      if (truncated) {
        reply.status(413);
        return { error: 'file_too_large', maxBytes: MAX_FILE_BYTES };
      }
      if (!fileBuf || fileBuf.length === 0) {
        reply.status(400);
        return { error: 'file_required' };
      }

      const kind = (fields.kind ?? 'photo') as CaptureKind;
      if (!KINDS.includes(kind)) {
        reply.status(400);
        return { error: 'invalid_kind', allowed: KINDS };
      }
      const title = (fields.title ?? '').slice(0, 256);
      const capturedAt = normalizeCapturedAt(fields.capturedAt);
      const geo = parseGeo(fields.geo);

      const tenant = await getTenantSettings(deps.sql, u.tid);
      const tenantLocale = tenant?.locale ?? 'pt-BR';
      const mediaSha256 = sha256Hex(fileBuf);

      // 1. Seal a chained event whose payload anchors the media file's hash.
      const payload = {
        type: 'capture',
        kind,
        title,
        appUserId: u.sub,
        appUserEmail: u.email,
        media: {
          sha256: mediaSha256,
          contentType: fileContentType,
          sizeBytes: fileBuf.length,
        },
        geo,
        capturedAt,
      };
      const event = await appendEvent(deps.sql, {
        tenantId: u.tid,
        source: `app:${kind}`,
        payload,
      });

      const retainUntilIso =
        deps.config.RETAIN_MODE === 'none'
          ? null
          : computeRetainUntil(deps.config.RETAIN_YEARS);

      // 2. Store the raw media file at its own immutable key.
      const objectKey = `${u.tid}/media/${event.id}.${captureExtension(fileContentType)}`;
      const media = await deps.persistence.storeMedia({
        tenantId: u.tid,
        objectKey,
        body: fileBuf,
        contentType: fileContentType,
        retainMode: deps.config.RETAIN_MODE,
        retainUntilIso,
        kmsKeyId: deps.config.STORAGE_KMS_KEY_ID,
      });

      // 3. RFC-3161 timestamp + canonical envelope for the event payload.
      const evidence = await deps.persistence.persist({
        tenantId: u.tid,
        tenantLocale,
        event,
        payload,
        retainMode: deps.config.RETAIN_MODE,
        retainUntilIso,
        kmsKeyId: deps.config.STORAGE_KMS_KEY_ID,
      });

      // 4. Index the capture for Minhas Provas + admin review.
      const capture = await recordCapture(deps.sql, {
        tenantId: u.tid,
        appUserId: u.sub,
        eventId: event.id,
        kind,
        title,
        contentType: fileContentType,
        sizeBytes: fileBuf.length,
        mediaSha256,
        store: media.store,
        objectKey: media.objectKey,
        geo,
        capturedAt,
      });

      reply.status(201);
      return { capture, event, evidence };
    },
  );

  // ---- ATA: audio → speech-to-text → sealed document + RFC-3161 ----
  // Form fields: title, capturedAt, geo, language, participants (JSON), + audio file.
  // NOTE: digital signature of participants is a separate, still-pending step
  // (awaiting the client's choice of method); the sealed transcript is produced
  // here and the signature status is recorded as 'pending'.
  app.post(
    '/app/v1/ata',
    {
      preHandler: requireUser,
      schema: {
        tags: ['user-app'],
        summary: 'Record an ATA: audio is transcribed, then sealed + RFC-3161 timestamped',
        consumes: ['multipart/form-data'],
      },
    },
    async (req, reply) => {
      const u = req.appUser!;
      let parsed: ParsedUpload;
      try {
        parsed = await readUpload(req);
      } catch {
        reply.status(400);
        return { error: 'invalid_multipart' };
      }
      const { fileBuf, fileContentType, truncated, fields } = parsed;
      if (truncated) {
        reply.status(413);
        return { error: 'file_too_large', maxBytes: MAX_FILE_BYTES };
      }
      if (!fileBuf || fileBuf.length === 0) {
        reply.status(400);
        return { error: 'file_required' };
      }

      const title = (fields.title ?? '').slice(0, 256);
      const capturedAt = normalizeCapturedAt(fields.capturedAt);
      const geo = parseGeo(fields.geo);
      const language = fields.language?.slice(0, 8) || undefined;

      let participants: { name?: string; email?: string }[] = [];
      if (fields.participants) {
        try {
          const arr = JSON.parse(fields.participants);
          if (Array.isArray(arr)) {
            participants = arr
              .slice(0, 50)
              .map((p) => ({
                name: typeof p?.name === 'string' ? p.name.slice(0, 200) : undefined,
                email: typeof p?.email === 'string' ? p.email.slice(0, 200) : undefined,
              }));
          }
        } catch {
          /* ignore malformed participants */
        }
      }

      // 1. Speech-to-text.
      const sttFilename = `ata.${captureExtension(fileContentType)}`;
      req.log.info(
        { contentType: fileContentType, filename: sttFilename, size: fileBuf.length, language },
        'ATA: forwarding to transcriber',
      );
      let transcript = '';
      let transcriptionMeta = { provider: deps.transcriber.id, model: '', language };
      try {
        const r = await deps.transcriber.transcribe({
          audio: fileBuf,
          contentType: fileContentType,
          filename: sttFilename,
          language,
        });
        transcript = r.text;
        transcriptionMeta = { provider: r.provider, model: r.model, language: r.language ?? language };
      } catch (err) {
        const detail = err instanceof Error ? err.message.slice(0, 500) : String(err);
        req.log.error(
          { err, contentType: fileContentType, filename: sttFilename, size: fileBuf.length },
          'ATA transcription failed',
        );
        reply.status(502);
        return { error: 'transcription_failed', detail };
      }

      const tenant = await getTenantSettings(deps.sql, u.tid);
      const tenantLocale = tenant?.locale ?? 'pt-BR';
      const mediaSha256 = sha256Hex(fileBuf);

      // 2. Seal a chained event anchoring the transcript + audio + metadata.
      const payload = {
        type: 'ata',
        kind: 'ata' as const,
        title,
        appUserId: u.sub,
        appUserEmail: u.email,
        transcript,
        transcription: transcriptionMeta,
        participants,
        // Digital signatures are a pending step (method TBD by the client).
        signatures: { status: 'pending' as const, method: null as string | null, signed: [] },
        media: { sha256: mediaSha256, contentType: fileContentType, sizeBytes: fileBuf.length },
        geo,
        capturedAt,
      };
      const event = await appendEvent(deps.sql, {
        tenantId: u.tid,
        source: 'app:ata',
        payload,
      });

      const retainUntilIso =
        deps.config.RETAIN_MODE === 'none' ? null : computeRetainUntil(deps.config.RETAIN_YEARS);

      // 3. Store the source audio file at its own immutable key.
      const objectKey = `${u.tid}/media/${event.id}.${captureExtension(fileContentType)}`;
      const media = await deps.persistence.storeMedia({
        tenantId: u.tid,
        objectKey,
        body: fileBuf,
        contentType: fileContentType,
        retainMode: deps.config.RETAIN_MODE,
        retainUntilIso,
        kmsKeyId: deps.config.STORAGE_KMS_KEY_ID,
      });

      // 4. RFC-3161 timestamp + canonical envelope (the sealed ATA document).
      const evidence = await deps.persistence.persist({
        tenantId: u.tid,
        tenantLocale,
        event,
        payload,
        retainMode: deps.config.RETAIN_MODE,
        retainUntilIso,
        kmsKeyId: deps.config.STORAGE_KMS_KEY_ID,
      });

      // 5. Index for Minhas Provas + admin review (transcript stored for preview).
      const capture = await recordCapture(deps.sql, {
        tenantId: u.tid,
        appUserId: u.sub,
        eventId: event.id,
        kind: 'ata',
        title,
        contentType: fileContentType,
        sizeBytes: fileBuf.length,
        mediaSha256,
        store: media.store,
        objectKey: media.objectKey,
        geo,
        capturedAt,
        transcript,
      });

      // 6. Create a signer (with a public signing link) per named participant.
      const signers = await createAtaSigners(deps.sql, {
        tenantId: u.tid,
        captureId: capture.id,
        eventId: event.id,
        participants: participants.filter((p) => p.name || p.email),
      });

      reply.status(201);
      return {
        capture,
        transcript,
        event,
        evidence,
        signers: signers.map((s) => signerForOwner(s, deps.config.PUBLIC_BASE_URL)),
      };
    },
  );

  // ---- Minhas Provas: list ----
  app.get('/app/v1/captures', { preHandler: requireUser }, async (req) => {
    const u = req.appUser!;
    const captures = await listCapturesByUser(deps.sql, u.tid, u.sub);
    return { captures };
  });

  // ---- Capture detail (metadata + chain verification + timestamp) ----
  app.get<{ Params: { id: string } }>(
    '/app/v1/captures/:id',
    { preHandler: requireUser },
    async (req, reply) => {
      const u = req.appUser!;
      const capture = await getCapture(deps.sql, u.tid, req.params.id);
      if (!capture || capture.appUserId !== u.sub) {
        reply.status(404);
        return { error: 'not_found' };
      }
      const detail = await getEventDetail(deps.sql, u.tid, capture.eventId);
      const signers =
        capture.kind === 'ata'
          ? (await listSignersByCapture(deps.sql, u.tid, capture.id)).map((s) =>
              signerForOwner(s, deps.config.PUBLIC_BASE_URL),
            )
          : [];
      return { capture, event: detail, signers };
    },
  );

  // ---- Download the raw media file (owner only) ----
  app.get<{ Params: { id: string } }>(
    '/app/v1/captures/:id/media',
    { preHandler: requireUser },
    async (req, reply) => {
      const u = req.appUser!;
      const capture = await getCapture(deps.sql, u.tid, req.params.id);
      if (!capture || capture.appUserId !== u.sub) {
        reply.status(404);
        return { error: 'not_found' };
      }
      const { body, contentType } = await deps.persistence.getMedia(capture.objectKey);
      reply.header('Content-Type', contentType ?? capture.contentType);
      reply.header('X-Evidence-Sha256', capture.mediaSha256);
      return reply.send(body);
    },
  );

  // ---- Evidence certificate (PDF bundling everything needed to verify) ----
  app.get<{ Params: { id: string } }>(
    '/app/v1/captures/:id/certificate.pdf',
    { preHandler: requireUser },
    async (req, reply) => {
      const u = req.appUser!;
      const capture = await getCapture(deps.sql, u.tid, req.params.id);
      if (!capture || capture.appUserId !== u.sub) {
        reply.status(404);
        return { error: 'not_found' };
      }
      const pdf = await buildCertificate(deps, capture);
      reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `attachment; filename="evidence-${capture.id}.pdf"`,
        )
        .header('X-Evidence-Pdf-Sha256', pdf.sha256);
      return reply.send(pdf.pdf);
    },
  );
}
