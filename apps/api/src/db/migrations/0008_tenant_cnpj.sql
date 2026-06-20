-- Tenants get a CNPJ (Brazilian company id) used as the routing key when we
-- report findings to the CTI Trust Hub. Stored as-typed (tenants might type
-- "12.345.678/0001-99" with formatting) and normalized to 14 digits at
-- CTI-send time. NULL = the tenant simply hasn't set a CNPJ yet; the CTI
-- emitter will skip the report (logged warning) rather than fail the save.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cnpj text;
