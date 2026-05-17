-- EVIDENCE — initial schema
-- Creates tenants, api_keys, events, and a per-tenant chain tip table.
-- Enables Row-Level Security with tenant-scoped policies enforced via the
-- application setting `evidence.tenant_id` set per request.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  locale      text NOT NULL DEFAULT 'pt-BR',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash    text NOT NULL,
  label       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON api_keys(tenant_id);

CREATE TABLE IF NOT EXISTS events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  seq           bigint NOT NULL,
  source        text NOT NULL,
  external_id   text,
  payload       jsonb NOT NULL,
  payload_hash  text NOT NULL,
  prev_hash     text NOT NULL,
  chain_hash    text NOT NULL,
  -- created_at is application-generated ISO-8601 (UTC, ms precision) and is part
  -- of the chain hash input, so it must round-trip exactly. Storing as text
  -- avoids Postgres timestamp format normalization.
  created_at    text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS events_tenant_seq_idx ON events(tenant_id, seq);
CREATE INDEX IF NOT EXISTS events_tenant_created_at_idx ON events(tenant_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS events_tenant_external_id_idx
  ON events(tenant_id, source, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_chain_hash_idx ON events(chain_hash);

-- Per-tenant chain tip used to serialize appends under SELECT ... FOR UPDATE.
CREATE TABLE IF NOT EXISTS tenant_chain_tips (
  tenant_id   uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  seq         bigint NOT NULL DEFAULT 0,
  chain_hash  text NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Row Level Security: scope reads/writes to the tenant set on the connection.
-- The API issues `SELECT set_config('evidence.tenant_id', $1, true)` at the
-- start of every tenant-scoped transaction.
ALTER TABLE events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_chain_tips  ENABLE ROW LEVEL SECURITY;

CREATE POLICY events_tenant_isolation ON events
  USING (tenant_id::text = current_setting('evidence.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('evidence.tenant_id', true));

CREATE POLICY api_keys_tenant_isolation ON api_keys
  USING (tenant_id::text = current_setting('evidence.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('evidence.tenant_id', true));

CREATE POLICY tenant_chain_tips_isolation ON tenant_chain_tips
  USING (tenant_id::text = current_setting('evidence.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('evidence.tenant_id', true));
