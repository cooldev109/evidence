-- ATA captures carry a speech-to-text transcript. Stored on the capture row
-- (in addition to being sealed inside the event payload) so list/review
-- screens can show it without fetching the full event.
ALTER TABLE captures ADD COLUMN IF NOT EXISTS transcript text;
