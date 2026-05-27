-- Add a per-capture unguessable share token. Used in the PDF certificate so a
-- recipient who only has the PDF (no login) can still open the original media
-- file via /public/v1/share/<token>. Existing rows are backfilled with random
-- tokens so previously-generated captures keep working.

ALTER TABLE captures ADD COLUMN IF NOT EXISTS share_token text;

-- Backfill any pre-existing rows. encode(gen_random_bytes(24), 'base64') gives
-- 32 chars; map '+'/'/' to URL-safe equivalents and strip the '=' padding.
UPDATE captures
   SET share_token = rtrim(translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_'), '=')
 WHERE share_token IS NULL;

ALTER TABLE captures ALTER COLUMN share_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS captures_share_token_idx ON captures(share_token);
