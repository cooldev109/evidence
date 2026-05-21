-- EVIDENCE — Milestone 3: persisted legal reports.
--
-- Each generated PDF is recorded so its QR code / short URL can resolve to a
-- verification of the exact event range the report covers, and so a holder can
-- compare their downloaded PDF's SHA-256 against the recorded value.

CREATE TABLE IF NOT EXISTS reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_seq    bigint NOT NULL,
  to_seq      bigint NOT NULL,
  locale      text NOT NULL,
  pdf_sha256  text NOT NULL,
  page_count  int NOT NULL,
  created_at  text NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_tenant_idx ON reports(tenant_id);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY reports_isolation ON reports
  USING (tenant_id::text = current_setting('evidence.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('evidence.tenant_id', true));
