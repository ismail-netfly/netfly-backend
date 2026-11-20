# Netfly API — v1.1.0

Base URL (production): `https://netfly-backend-akeh.onrender.com`
Local dev: `http://localhost:3000`

All responses are JSON. List/detail endpoints wrap rows in `{ "data": ... }`.
Errors are `{ "message": "..." }` with an HTTP status (400 validation,
401 missing/invalid token, 403 admin only, 404 not found, 409 conflict,
500 server error). Rate limit: 600 requests / 15 min per IP on `/api/`.

Auth: `Authorization: Bearer <JWT>` (from login/register/Google).
`stream_url` and playable sources are only returned to logged-in callers;
anonymous callers get `stream_url: null` and an empty sources list.

## Health

### `GET /health`
No auth. `{ "ok": true, "app": "netfly" }`.

## Auth — `/api/auth`

### `POST /api/auth/register`
Body: `{ "name", "email", "password" }` (password 8+ chars).
`201 → { "token", "user": { "id", "name", "email", "is_admin", "is_premium" } }`.
`409` when the email is already registered.

### `POST /api/auth/login`
Body: `{ "email", "password" }`.
`200 → { "token", "user": {...} }`. `401` on bad credentials.

### `POST /api/auth/google`
Body: `{ "id_token" }` (Google ID token). Creates the user on first sign-in.
`200 → { "token", "user": {...} }`.

### `GET /api/auth/me`
Auth required. `200 → { "data": { "id", "name", "email", "is_admin", "is_premium" } }`.

## Movies — `/api/movies`

### `GET /api/movies?category=&catalog=&genre=&year=&language=&page=`
Optional auth (`stream_url` only when logged in).
- `category`: `trending` | `popular` | `top_rated` | `latest` | `upcoming` | `featured`
  (trending/popular = popularity; latest/upcoming use `release_date`).
- `catalog`: `hollywood` | `bollywood` | `pakistani` | `korean` | `chinese` | `turkish` | `anime`
- `page`: 1-based, 24 per page.

Example:
```
GET /api/movies?category=trending&catalog=bollywood&page=1
→ { "data": [ { "id": 174, "title": "Hero", "overview": "...",
      "release_year": 1983, "imdb_rating": 6.1, "duration_minutes": 157,
      "language": "hi", "poster_url": "https://image.tmdb.org/t/p/w500/...",
      "backdrop_url": "...", "trailer_url": "https://www.youtube.com/watch?v=...",
      "genres": ["Action"], "cast": [], "is_featured": false,
      "is_premium": false, "stream_url": null } ], "page": 1 }
```

### `GET /api/movies/categories`
Public. Active catalog categories: `{ "data": [ { "id", "slug", "name", "kind" } ] }`.

### `GET /api/movies/:id`
Optional auth. Detail + `sources` (trailers/providers public; playable
streams only when logged in; broken sources never shown).
`404` when missing or unpublished.

## Playable sources — `/api/titles`, `/api/series` (v1.1.0)

A title is **playable iff this list is non-empty**. A source appears here
only when ALL of these hold: `source_type='public_domain'`,
`is_playable=true`, `enabled=true`, `status='ok'` (HEAD-checked),
`stream_validated=true` (ffprobe proved a real video), and its provider
row is enabled (legacy rows with no provider link count as enabled).
Provider/trailer rows can never appear here.

### `GET /api/titles/:id/sources`
Optional auth — anonymous callers get `{ "data": [] }`; logged-in callers
get the playable streams, lowest `priority` first. `404` for an unknown
or unpublished movie.

Example:
```
GET /api/titles/518/sources   (Authorization: Bearer <token>)
→ { "data": [ { "id": 2288, "provider_name": "Archive.org",
      "format": "mp4",
      "url": "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4",
      "quality": "720p", "priority": 1 } ] }
```

### `GET /api/series/:id/sources`
Same contract for series. `404` for an unknown or unpublished series.

## Series — `/api/series`

### `GET /api/series?category=&catalog=&page=`
Optional auth. `category`: `trending` | `popular` | `latest` | `top_rated` |
`upcoming` | `featured`. Same `catalog` slugs as movies. 24 per page.

### `GET /api/series/:id`
Optional auth. Detail + `seasons` (each with `episodes`; episode
`stream_url` only when logged in) + `sources` (same rules as movies).

## Search — `/api/search`

### `GET /api/search?q=&genre=&year=&min_rating=`
Optional auth. Searches movie title, cast, genre and language
(server-side `ILIKE`). Empty `q` → `{ "data": [] }`. Max 50 rows.
`stream_url` is always `null` here.

Example: `GET /api/search?q=chaplin&min_rating=7`

## Watchlist — `/api/watchlist` (auth required)

### `GET /api/watchlist`
The caller's saved movies.

### `POST /api/watchlist`
Body: `{ "movie_id": 174 }`. Adds the movie.

### `DELETE /api/watchlist/:movieId`
Removes the movie.

## History — `/api/history` (auth required)

### `POST /api/history/progress`
Body: `{ "content_id", "content_type": "movie"|"episode",
"progress_seconds", "duration_seconds" }`. Called ~every 15 s by the
player. `401` for anonymous callers (the app then falls back to local
progress storage).

### `GET /api/history/continue`
Continue-watching list. Anonymous callers get `401` (the app shows an
empty list instead of failing).

### `POST /api/history/watched/:episodeId`
Marks an episode watched.

## Subscriptions — `/api/subscriptions`

### `GET /api/subscriptions/plans`
Public. `{ "data": [ { "id", "product_id", "days", ... } ] }`.

### `POST /api/subscriptions/verify`
Auth required. Body: `{ "product_id", "purchase_token" }`. Verifies a
store purchase and grants premium. (Server-side grant is wired to the
store verification; see `routes/subscriptions.js`.)

## Admin — `/api/admin` (auth + `is_admin` required on every route)

### `GET /api/admin/stats`
`{ "data": { "total_users", "active_premium_users", "total_movies",
"total_series", "popular_content": [ { "id", "title", "views" } ] } }`.

### Movies CRUD
- `POST /api/admin/movies` — body: title, overview, release_year,
  imdb_rating, duration_minutes, language, poster_url, backdrop_url,
  trailer_url, stream_url, genres[], cast[], is_featured, is_premium,
  is_published. `201 → { "data": movie }`. `stream_url` must be an
  authorised HLS/DASH URL — never a pirated source.
- `PUT /api/admin/movies/:id` — same fields. `404` when missing.
- `DELETE /api/admin/movies/:id` — `200 { "message": "Movie deleted" }`.
- `POST /api/admin/movies/:id/featured` — body `{ "is_featured": true }`.
- `GET/POST/DELETE /api/admin/movies/:id/categories[/:categoryId]` —
  assign/remove catalog categories (`{ "category_id" }` on POST).
- Same `featured` + `categories` routes exist under
  `/api/admin/series/:id/...`.

### `POST /api/admin/upload`
Multipart image (max 10 MB). `201 → { "url": "/uploads/<file>" }`.
Production must swap disk storage for object storage.

### `GET /api/admin/users` / `GET /api/admin/subscriptions`
Latest 100 rows each.

### `GET /api/admin/genres` / `POST /api/admin/genres`
List all genres; create with `{ "name" }` (conflict-safe).

### Sources — `/api/admin/sources`
`title_sources` rows with the joined movie/series title.
**Hard guard (never bypassed):** only `source_type='public_domain'`
rows with a direct `.mp4` / `.m3u8` / `.mpd` URL may have
`is_playable=true`. A YouTube URL can never become a stream, and
`is_playable=true` is never allowed on provider/trailer rows — the API
forces it to `false` even if the client sends `true`. `format` is
derived from the URL extension when not supplied; `priority` defaults
to 100; `enabled` defaults to `true`.

- `GET /api/admin/sources?status=&source_type=&provider=&q=&limit=&offset=`
  Filters: `status` (`ok` | `broken` | `unchecked`), `source_type`
  (`trailer` | `provider` | `public_domain`), `provider` (ILIKE on
  provider_name), `q` (title search). Limit max 200, default 50.
  Example: `GET /api/admin/sources?status=broken`
- `GET /api/admin/sources/broken` — broken rows, newest first, max 200.
- `GET /api/admin/sources/health` — `{ "data": { "playable_ok",
  "broken", "unchecked", "ok", "total",
  "providers": [ { "provider_name", "enabled", "last_sync_at",
  "total", "ok", "broken", "unchecked", "playable_ok" } ],
  "broken_sources": [ ... ] } }`. `playable_ok` counts sources that
  are actually playable (public-domain, enabled, status ok, ffprobe
  validated).
- `POST /api/admin/sources` — body: exactly one of `movie_id` /
  `series_id`, `source_type`, `url` (http/https), optional
  `provider_name`, `provider_id`, `provider_logo_path`, `offer_type`,
  `language`, `quality`, `region`, `is_playable`, `status`, `priority`,
  `format`, `enabled`. `201 → { "data": source }`. `400` on a bad type,
  a non-direct playable URL, or a missing title link.
- `PUT /api/admin/sources/:id` — partial update; the guard is validated
  against the *resulting* row. Changing the URL re-derives `format`
  unless one is supplied. Setting `status` refreshes `last_checked_at`.
- `DELETE /api/admin/sources/:id` — `200 { "message": "Source deleted" }`.

Source object (admin view):
```
{ "id": 2288, "movie_id": 518, "series_id": null,
  "source_type": "public_domain", "provider_name": "Archive.org",
  "provider_key": "archiveorg", "external_id": "BigBuckBunny_124",
  "url": "https://archive.org/download/...mp4", "format": "mp4",
  "quality": "720p", "language": null, "region": null,
  "is_playable": true, "status": "ok", "priority": 1, "enabled": true,
  "stream_validated": true, "stream_codec": "h264",
  "stream_width": 640, "stream_height": 360, "stream_duration": 596.48,
  "movie_title": "Big Buck Bunny", "series_title": null }
```

### Providers — `/api/admin/providers`
The provider registry. The app's Providers tab reads `provider_name`,
`count` (alias of `total`) and `broken_count`; those keys are kept.
Each row also carries per-provider monitoring: `ok` / `ok_count`,
`broken`, `unchecked`, `total`, `playable`, `enabled`, `last_sync_at`,
`adapter`, `config`. Legacy provider link-outs with no registry row
(e.g. Netflix, YouTube) are appended as registry-less groups
(`adapter: null`, `enabled: true`) so nothing previously shown
disappears.

- `GET /api/admin/providers` — registry rows + legacy groups.
- `POST /api/admin/providers` — body `{ "name", "adapter", "config"?,
  "enabled"? }`. `name` is lowercase letters/digits/hyphens and is the
  stable key other rows reference. `201`. `409` on a duplicate name.
- `PUT /api/admin/providers/:id` — update `adapter`, `config`,
  `enabled`. Renaming is not allowed. **Disabling a provider
  (`enabled: false`) hides its playable streams from the app
  immediately, with no APK change.**
- `DELETE /api/admin/providers/:id` — `409` while any `title_sources`
  row still references the provider; delete or reassign those first.

### Sync state
- `GET /api/admin/sync-state` — the last daily sync's row
  (`last_sync_at`, `movies_upserted`, `series_upserted`,
  `providers_stored`, `trailers_stored`, `categories_assigned`,
  `last_error`), or a zeroed default when the sync has never run.
- `POST /api/admin/sync/trigger` — the sync is a separate scheduled job
  (it needs the TMDB key + DB tunnel, which do not live in the API
  process). Returns the command to run; it does not start a sync.

### Categories — `/api/admin/categories`
- `GET` — all categories (active and inactive).
- `POST` — `{ "slug", "name", "kind"? ("region"|"genre"|"custom"),
  "tmdb_language"?, "tmdb_region"?, "tmdb_genre_id"?, "is_active"?,
  "sort_order"? }`. `409` on a duplicate slug.
- `PUT /api/admin/categories/:id`, `DELETE /api/admin/categories/:id`.
