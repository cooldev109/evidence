-- Lightweight click-to-sign for ATA. One row per meeting participant who must
-- sign. Each signer gets an unguessable token used in a public signing link.
-- Signing appends its own hash-chained, RFC-3161-timestamped event (signed_event_id),
-- so each signature is independently tamper-evident and time-anchored — without
-- requiring the participant to have an account or a digital certificate.

CREATE TABLE IF NOT EXISTS ata_signers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  capture_id      uuid NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,  -- the ATA event
  name            text NOT NULL DEFAULT '',
  email           text NOT NULL DEFAULT '',
  token           text NOT NULL,                 -- signing-link token (unguessable)
  signed_at       text,                          -- ISO timestamp once signed
  signed_event_id uuid REFERENCES events(id),    -- the chained signature event
  created_at      text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ata_signers_token_idx ON ata_signers(token);
CREATE INDEX IF NOT EXISTS ata_signers_capture_idx ON ata_signers(capture_id);

ALTER TABLE ata_signers ENABLE ROW LEVEL SECURITY;
CREATE POLICY ata_signers_isolation ON ata_signers
  USING (tenant_id::text = current_setting('evidence.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('evidence.tenant_id', true));
