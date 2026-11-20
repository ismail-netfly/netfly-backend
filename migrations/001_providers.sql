-- Netfly v1.1.0 migration 001 — provider registry.
-- Idempotent: CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING.
-- Applied live 2026-11-20. The APK never knows about providers: it only
-- calls GET /api/titles/:id/sources and plays returned URLs by format.
-- Adding a provider = a row here (+ a new adapter module in
-- engine/providers/ only if the source needs a new API shape).

CREATE TABLE IF NOT EXISTS providers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  adapter VARCHAR(50) NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO providers (name, adapter, config) VALUES
  ('tmdb', 'tmdb',
   '{"note": "TMDB watch-provider link-outs only; never playable"}'::jsonb),
  ('archiveorg', 'archiveorg',
   '{"query": "mediatype:movies AND collection:feature_films AND licenseurl:*publicdomain*", "sort": "downloads desc", "note": "Public-domain feature films; playable direct .mp4 streams"}'::jsonb),
  ('generic_http', 'generic_http',
   '{"note": "Admin-added direct URLs only; only public_domain rows with a direct .mp4/.m3u8/.mpd URL can be playable"}'::jsonb)
ON CONFLICT (name) DO NOTHING;
