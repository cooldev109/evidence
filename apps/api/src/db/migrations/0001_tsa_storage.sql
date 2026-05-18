-- EVIDENCE — Milestone 2: TSA timestamping + append-only storage
--
-- event_timestamps: one row per (event, TSA provider) — multiple TSAs may
--   timestamp the same event (e.g., switch providers, dual-provider strategy).
-- evidence_objects: pointer to the immutable storage location holding the
--   canonical evidence envelope (payload + hash + tsa_token + chain context).

CREATE TABLE IF NOT EXISTS event_timestamps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  jurisdiction  text NOT NULL,
  token         bytea NOT NULL,
  issued_at     text NOT NULL,
  digest_hex    text NOT NULL,
  created_at    text NOT NULL
);
CREATE INDEX IF NOT EXISTS event_timestamps_event_idx ON event_timestamps(event_id);
CREATE INDEX IF NOT EXISTS event_timestamps_tenant_idx ON event_timestamps(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS event_timestamps_event_provider_idx
  ON event_timestamps(event_id, provider);

CREATE TABLE IF NOT EXISTS evidence_objects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store           text NOT NULL,           -- 'local' | 's3'
  bucket          text NOT NULL,           -- bucket name OR local root dir
  object_key      text NOT NULL,           -- path within the store
  version_id      text,                    -- S3 version id, if applicable
  size_bytes      bigint NOT NULL,
  sha256          text NOT NULL,           -- digest of the stored envelope
  kms_key_id      text,                    -- ARN/alias of the KMS key (S3 only)
  retain_until    text,                    -- ISO-8601, when the lock can be lifted
  retain_mode     text,                    -- 'compliance' | 'governance' | 'none'
  created_at      text NOT NULL
);
CREATE INDEX IF NOT EXISTS evidence_objects_tenant_idx ON evidence_objects(tenant_id);

-- Tenant defaults for TSA + retention (1 row per tenant; ON CONFLICT to upsert).
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id           uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  tsa_provider        text,                 -- override; NULL means locale default
  retention_years     int NOT NULL DEFAULT 5,
  retain_mode         text NOT NULL DEFAULT 'governance',
  updated_at          text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

ALTER TABLE event_timestamps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_objects    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings     ENABLE ROW LEVEL SECURITY;

CREATE POLICY event_timestamps_isolation ON event_timestamps
  USING (tenant_id::text = current_setting('evidence.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('evidence.tenant_id', true));

CREATE POLICY evidence_objects_isolation ON evidence_objects
  USING (tenant_id::text = current_setting('evidence.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('evidence.tenant_id', true));

CREATE POLICY tenant_settings_isolation ON tenant_settings
  USING (tenant_id::text = current_setting('evidence.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('evidence.tenant_id', true));
