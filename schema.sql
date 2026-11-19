-- NETFLY database schema — PostgreSQL 14+
-- Run: psql "$DATABASE_URL" -f schema.sql
-- Field names match lib/models/*.dart and docs/API.md.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,                 -- NULL for Google-only accounts
  google_id TEXT UNIQUE,
  avatar_url TEXT,
  is_premium BOOLEAN NOT NULL DEFAULT FALSE,
  premium_plan TEXT,                  -- 'monthly' | 'quarterly' | 'yearly'
  premium_expires_at TIMESTAMPTZ,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS genres (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO genres (name) VALUES
  ('Action'), ('Adventure'), ('Horror'), ('Comedy'), ('Thriller'),
  ('Romance'), ('Sci-Fi'), ('Mystery'), ('Animation'), ('Documentary'),
  ('Drama')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS movies (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  overview TEXT,
  release_year INT,
  imdb_rating NUMERIC(3,1),
  duration_minutes INT,
  language TEXT,
  poster_url TEXT,
  backdrop_url TEXT,
  trailer_url TEXT,                   -- authorised trailer (e.g. YouTube)
  stream_url TEXT,                    -- authorised HLS/DASH URL only; NULL = not streamable
  genres TEXT[] NOT NULL DEFAULT '{}',
  "cast" TEXT[] NOT NULL DEFAULT '{}',
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_premium BOOLEAN NOT NULL DEFAULT FALSE,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  popularity NUMERIC DEFAULT 0,
  views BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_movies_featured ON movies (is_featured) WHERE is_published;
CREATE INDEX IF NOT EXISTS idx_movies_popularity ON movies (popularity DESC);
CREATE INDEX IF NOT EXISTS idx_movies_title ON movies USING gin (to_tsvector('english', title));

CREATE TABLE IF NOT EXISTS series (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  overview TEXT,
  release_year INT,
  imdb_rating NUMERIC(3,1),
  language TEXT,
  poster_url TEXT,
  backdrop_url TEXT,
  trailer_url TEXT,
  genres TEXT[] NOT NULL DEFAULT '{}',
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  popularity NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seasons (
  id SERIAL PRIMARY KEY,
  series_id INT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  season_number INT NOT NULL,
  title TEXT,
  UNIQUE (series_id, season_number)
);

CREATE TABLE IF NOT EXISTS episodes (
  id SERIAL PRIMARY KEY,
  season_id INT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  episode_number INT NOT NULL,
  title TEXT NOT NULL,
  overview TEXT,
  duration_minutes INT,
  thumbnail_url TEXT,
  stream_url TEXT,                    -- authorised HLS/DASH URL only
  UNIQUE (season_id, episode_number)
);

CREATE TABLE IF NOT EXISTS watchlist (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id INT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, movie_id)
);

CREATE TABLE IF NOT EXISTS watch_history (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id INT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('movie', 'episode')),
  progress_seconds INT NOT NULL DEFAULT 0,
  duration_seconds INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, content_id, content_type)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,                 -- 'monthly' | 'quarterly' | 'yearly'
  product_id TEXT NOT NULL,
  purchase_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'cancelled' | 'expired'
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ads_config (
  id SERIAL PRIMARY KEY,
  placement TEXT NOT NULL UNIQUE,     -- 'banner_home' | 'interstitial' | 'rewarded'
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  admob_unit_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ads_config (placement, enabled) VALUES
  ('banner_home', TRUE), ('interstitial', TRUE), ('rewarded', TRUE)
ON CONFLICT (placement) DO NOTHING;
