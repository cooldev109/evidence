-- EVIDENCE — Milestone 4: admin users + audit log.
--
-- admin_users authenticate to the admin panel with email + password and are
-- scoped to a single tenant (multi-tenant SaaS: each customer's operators
-- manage only their own tenant). audit_events records every admin action.

CREATE TABLE IF NOT EXISTS admin_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'admin',
  created_at    text NOT NULL,
  last_login_at text
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_idx ON admin_users(lower(email));
CREATE INDEX IF NOT EXISTS admin_users_tenant_idx ON admin_users(tenant_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_email text NOT NULL,
  action      text NOT NULL,
  detail      jsonb,
  created_at  text NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_tenant_idx ON audit_events(tenant_id, created_at);

ALTER TABLE admin_users  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_users_isolation ON admin_users
  USING (tenant_id::text = current_setting('evidence.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('evidence.tenant_id', true));

CREATE POLICY audit_events_isolation ON audit_events
  USING (tenant_id::text = current_setting('evidence.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('evidence.tenant_id', true));
