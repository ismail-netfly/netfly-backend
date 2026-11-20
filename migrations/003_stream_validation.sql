-- Netfly v1.1.0 migration 003 — real stream validation + dedup keys.
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Applied live 2026-11-20.
--
-- stream_validated: TRUE only after engine/streamcheck.py proves the URL
--   is a real decodable video with ffprobe (video stream + duration > 0
--   + width/height). A HEAD 200 alone is NOT enough. The playable query
--   (routes/sourceHelpers.js getPlayableSources) requires this flag.
-- stream_codec / stream_width / stream_height / stream_duration: the
--   ffprobe result (e.g. h264, 1280, 720, 596.48).
-- stream_validated_at: when the last ffprobe validation ran.
-- external_id: the provider-side identifier (archive.org identifier for
--   archiveorg rows). Discovery dedups PD titles on this key.
--
-- DEDUP NOTE — there is deliberately NO unique index on (title, url):
-- it is unsafe. The live catalog has 120 (title, url) groups that share
-- one URL legitimately: TMDB returns a single watch-page URL per title
-- + region, shared by several providers/offer types (e.g. Netflix,
-- YouTube and Amazon Video all link the same themoviedb.org watch page
-- for one title). A (title, url) unique index would block those rows.
-- Dedup instead relies on the pre-existing full-key unique index
-- (title, source_type, provider_name, offer_type, url) plus pre-insert
-- existence checks in the sync/discovery code.

ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS stream_validated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS stream_codec VARCHAR(20);
ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS stream_width INT;
ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS stream_height INT;
ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS stream_duration NUMERIC(10,2);
ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS stream_validated_at TIMESTAMPTZ;
ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS external_id TEXT;
CREATE INDEX IF NOT EXISTS idx_title_sources_external_id ON title_sources (provider_key, external_id);
