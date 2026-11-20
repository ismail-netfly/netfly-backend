-- Netfly v1.1.0 migration 002 — multi-source playback on title_sources.
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Applied live 2026-11-20.
--
-- priority: playback order, lower = tried first (default 100).
-- format: container derived from the URL extension ('mp4' | 'm3u8' |
--   'mpd' | 'webm' | ...), NULL when unknown.
-- enabled: admin kill-switch; disabled sources are never returned as
--   playable (and never in the detail `sources` list either).
-- provider_key: link to the providers registry (NULL = legacy row,
--   treated as enabled). Disabling a provider hides its playable
--   streams from the app with no APK change.
--
-- Backfill: the TMDB sync's provider link-out rows belong to 'tmdb'.

ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 100;
ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS format VARCHAR(10);
ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS provider_key TEXT
  REFERENCES providers(name) ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_title_sources_priority ON title_sources (priority);
CREATE INDEX IF NOT EXISTS idx_title_sources_provider_key ON title_sources (provider_key);

UPDATE title_sources SET provider_key = 'tmdb'
  WHERE source_type = 'provider' AND provider_key IS NULL;
