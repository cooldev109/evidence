-- EVIDENCE — Part 1 (user app): end users + media captures.
--
-- app_users are the end users an admin registers; they log into the user app
-- and capture evidence (photos/videos/audio/ATA). Distinct from admin_users.
--
-- captures links a stored media file to the hash-chained event that seals it,
-- so "Minhas Provas" and admin review can list a user's evidence with the
-- actual file, geolocation, and the RFC-3161 proof.

CREATE TABLE IF NOT EXISTS app_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         text NOT NULL,
  password_hash text NOT NULL,
  name          text NOT NULL DEFAULT '',
  created_at    text NOT NULL,
  last_login_at text,
  disabled_at   text
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_idx ON app_users(lower(email));
CREATE INDEX IF NOT EXISTS app_users_tenant_idx ON app_users(tenant_id);

CREATE TABLE IF NOT EXISTS captures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  app_user_id   uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind          text NOT NULL,                 -- 'photo' | 'video' | 'audio' | 'ata'
  title         text NOT NULL DEFAULT '',
  content_type  text NOT NULL,
  size_bytes    bigint NOT NULL,
  media_sha256  text NOT NULL,                 -- sha256 of the media file itself
  store         text NOT NULL,                 -- 'local' | 's3'
  object_key    text NOT NULL,                 -- media file location in the evidence store
  geo           jsonb,                         -- { lat, lng, accuracy, address }
  captured_at   text NOT NULL,                 -- client-reported capture time (ISO)
  created_at    text NOT NULL
);
CREATE INDEX IF NOT EXISTS captures_user_idx ON captures(app_user_id, created_at);
CREATE INDEX IF NOT EXISTS captures_tenant_idx ON captures(tenant_id, created_at);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE captures  ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_users_isolation ON app_users
  USING (tenant_id::text = current_setting('evidence.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('evidence.tenant_id', true));

CREATE POLICY captures_isolation ON captures
  USING (tenant_id::text = current_setting('evidence.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('evidence.tenant_id', true));
