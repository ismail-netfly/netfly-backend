-- NETFLY Content Engine migration — Phase A (backend only).
-- Run AFTER schema.sql, against the live DB. The parent applies it; this
-- file is never applied by an agent automatically:
--   psql "$DATABASE_URL" -f engine-schema.sql
-- Safe to re-run: every statement is IF NOT EXISTS / ON CONFLICT guarded.
-- Adds: TMDB identity + release dates, catalog categories, title_sources,
-- sync_state. Does NOT touch existing rows (Sita keeps working as-is).

-- ------------------------------------------------------------------
-- 1. TMDB identity + release dates (needed for Upcoming / Latest)
-- ------------------------------------------------------------------
ALTER TABLE movies ADD COLUMN IF NOT EXISTS tmdb_id INT;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS release_date DATE;
ALTER TABLE series ADD COLUMN IF NOT EXISTS tmdb_id INT;
ALTER TABLE series ADD COLUMN IF NOT EXISTS first_air_date DATE;

-- Unique index so the sync can UPSERT by tmdb_id. NULLs never conflict,
-- so the existing manually-added rows (e.g. Sita, tmdb_id NULL) are safe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_movies_tmdb_id ON movies (tmdb_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_series_tmdb_id ON series (tmdb_id);
CREATE INDEX IF NOT EXISTS idx_movies_release_date ON movies (release_date);
CREATE INDEX IF NOT EXISTS idx_series_first_air_date ON series (first_air_date);

-- ------------------------------------------------------------------
-- 2. Catalog categories (Hollywood, Bollywood, Pakistani, Korean,
--    Chinese, Turkish, Anime). Assigned by the sync from TMDB metadata:
--    original_language + region, Anime = ja + Animation genre.
--    Pakistani will be SMALL on TMDB (very few ur-PK titles) — that is
--    honest TMDB coverage, never invented entries.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'region' CHECK (kind IN ('region', 'genre', 'custom')),
  tmdb_language TEXT,      -- e.g. 'en', 'hi', 'ur', 'ko', 'zh', 'tr', 'ja'
  tmdb_region TEXT,        -- e.g. 'US', 'IN', 'PK', 'KR', 'CN', 'TR', 'JP'
  tmdb_genre_id INT,       -- e.g. 16 for Anime (Animation)
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO categories (slug, name, kind, tmdb_language, tmdb_region, tmdb_genre_id, sort_order) VALUES
  ('hollywood', 'Hollywood', 'region', 'en', 'US', NULL, 1),
  ('bollywood', 'Bollywood', 'region', 'hi', 'IN', NULL, 2),
  ('pakistani', 'Pakistani', 'region', 'ur', 'PK', NULL, 3),
  ('korean',    'Korean',    'region', 'ko', 'KR', NULL, 4),
  ('chinese',   'Chinese',   'region', 'zh', 'CN', NULL, 5),
  ('turkish',   'Turkish',   'region', 'tr', 'TR', NULL, 6),
  ('anime',     'Anime',     'genre',  'ja', 'JP', 16,   7)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS movie_categories (
  movie_id INT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (movie_id, category_id)
);

CREATE TABLE IF NOT EXISTS series_categories (
  series_id INT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (series_id, category_id)
);

-- ------------------------------------------------------------------
-- 3. Playback / info sources for a title.
--    source_type: 'trailer'       -> YouTube trailer (public, link out)
--                 'provider'      -> TMDB watch-provider entry. The url is
--                                    TMDB's watch page for the title in that
--                                    region (e.g. .../watch?locale=PK); it is
--                                    a LINK OUT, not a playable stream.
--                                    is_playable is always FALSE here.
--                 'public_domain' -> direct playable MP4/HLS URL, verified
--                                    by an admin (archive.org pattern).
--                                    is_playable TRUE only for these.
--    Playable stream URLs are NEVER returned to anonymous API callers
--    (see routes/sourceHelpers.js) — same rule as movies.stream_url.
--    The checker owns `status`; the sync only refreshes last_seen_at.
--    Rows are never deleted by automation — only flagged.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS title_sources (
  id SERIAL PRIMARY KEY,
  movie_id INT REFERENCES movies(id) ON DELETE CASCADE,
  series_id INT REFERENCES series(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('trailer', 'provider', 'public_domain')),
  provider_name TEXT,              -- e.g. 'Netflix', 'YouTube', 'Archive.org'
  provider_id INT,                 -- TMDB provider id, if any
  provider_logo_path TEXT,         -- TMDB logo path, e.g. '/9A1JSVmSxsyaBK4SUFsYVfvZf2.jpg'
  offer_type TEXT,                 -- provider only: 'flatrate' | 'rent' | 'buy'
  url TEXT NOT NULL,
  language TEXT,                   -- e.g. 'en', 'hi', 'ur'
  quality TEXT,                    -- e.g. 'HD', '4K', 'SD' (NULL when unknown)
  region TEXT,                     -- e.g. 'PK', 'US'
  is_playable BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'unchecked' CHECK (status IN ('ok', 'broken', 'unchecked')),
  -- v1.1.0: playback priority (lower = tried first), container format
  -- ('mp4' | 'm3u8' | 'mpd' | ...), admin kill-switch.
  priority INT NOT NULL DEFAULT 100,
  format VARCHAR(10),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,        -- last sync run that still listed this source
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT title_sources_one_title CHECK (
    (movie_id IS NOT NULL AND series_id IS NULL) OR
    (movie_id IS NULL AND series_id IS NOT NULL)
  )
);

-- Dedup guard (expression index; NULLs are coalesced so the "one title"
-- rule above still holds). The sync uses UPDATE + INSERT ... WHERE NOT
-- EXISTS against this key instead of ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS idx_title_sources_unique
  ON title_sources (
    COALESCE(movie_id, -1),
    COALESCE(series_id, -1),
    source_type,
    COALESCE(provider_name, ''),
    COALESCE(offer_type, ''),
    url
  );
CREATE INDEX IF NOT EXISTS idx_title_sources_movie ON title_sources (movie_id);
CREATE INDEX IF NOT EXISTS idx_title_sources_series ON title_sources (series_id);
CREATE INDEX IF NOT EXISTS idx_title_sources_status ON title_sources (status);

-- v1.1.0 ALTERs: keep databases created from the pre-v1.1.0 schema in
-- sync (the CREATE TABLE above already has these columns for fresh DBs).
ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 100;
ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS format VARCHAR(10);
ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_title_sources_priority ON title_sources (priority);

-- ------------------------------------------------------------------
-- 3b. Provider registry (v1.1.0). The APK never knows about providers:
-- it only calls GET /api/titles/:id/sources and plays returned URLs.
-- Adding a provider = a row here (+ a new adapter module in
-- engine/providers/ only if the source needs a new API shape).
-- `name` is the stable key referenced by title_sources.provider_key.
-- Disabling a provider hides its playable streams from the app with
-- no APK change; its link-out rows stay visible.
-- ------------------------------------------------------------------
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

-- Link from title_sources to the registry (added after providers exists).
-- A NULL provider_key means a legacy row (pre-registry): treated as
-- enabled, so existing link-outs keep working unchanged.
ALTER TABLE title_sources ADD COLUMN IF NOT EXISTS provider_key TEXT
  REFERENCES providers(name) ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_title_sources_provider_key ON title_sources (provider_key);

-- ------------------------------------------------------------------
-- 4. Sync bookkeeping (single row, id = 1). Written by the daily sync.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_state (
  id INT PRIMARY KEY DEFAULT 1,
  last_sync_at TIMESTAMPTZ,
  movies_upserted INT NOT NULL DEFAULT 0,
  series_upserted INT NOT NULL DEFAULT 0,
  providers_stored INT NOT NULL DEFAULT 0,
  trailers_stored INT NOT NULL DEFAULT 0,
  categories_assigned INT NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sync_state_single_row CHECK (id = 1)
);
