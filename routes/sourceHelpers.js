// Shared helpers for title_sources, with the same gating rules as
// stream_url — playable direct streams are only returned to authorised
// (logged-in) callers. Trailers and provider link-outs are public, and
// sources flagged 'broken' by the checker are never shown to the app
// (the admin panel still lists them via /api/admin/sources?status=broken).
// Disabled sources (enabled=false) are never returned to the app.

// Derive the container format from a direct media URL's extension
// (query string / fragment ignored). Returns null when it cannot tell.
function deriveFormatFromUrl(u) {
  if (typeof u !== 'string') return null;
  const clean = u.split(/[?#]/)[0];
  const m = clean.match(/\.([a-z0-9]+)$/i);
  if (!m) return null;
  const fmt = m[1].toLowerCase();
  return fmt.length <= 10 ? fmt : null;
}

// All sources attached to a title, for the detail responses.
// Ordered by playback priority (lowest first), then type/provider.
// A disabled provider's *playable* streams are hidden; its link-outs
// stay visible (disabling must never hide where else a title is listed).
async function getSources(pool, { movieId = null, seriesId = null }, authed) {
  const col = movieId != null ? 'movie_id' : 'series_id';
  const id = movieId != null ? movieId : seriesId;
  const { rows } = await pool.query(
    `SELECT ts.id, ts.source_type, ts.provider_name, ts.provider_id,
            ts.provider_logo_path, ts.offer_type, ts.url, ts.language,
            ts.quality, ts.region, ts.is_playable, ts.status,
            ts.priority, ts.format, ts.enabled, ts.provider_key
     FROM title_sources ts
     LEFT JOIN providers p ON p.name = ts.provider_key
     WHERE ts.${col} = $1 AND ts.enabled = true AND ts.status != 'broken'
       AND ($2 OR NOT ts.is_playable)
       AND (NOT ts.is_playable OR ts.provider_key IS NULL OR p.enabled = true)
     ORDER BY ts.priority ASC, ts.source_type, ts.provider_name`,
    [id, !!authed],
  );
  return rows;
}

// Playable sources for one title: direct streams only, enabled, health-
// checked ok, ffprobe-validated as a real video, and from an enabled
// provider (NULL provider_key = legacy row, treated as enabled). Lowest
// priority first. source_type is filtered to 'public_domain' explicitly —
// provider/trailer rows can never appear as playable, whatever flags
// they carry. This list decides playability — a title is playable iff it
// has >= 1 row here; the stored is_playable flag alone never makes a
// title playable. Only the fields the player needs are returned.
async function getPlayableSources(pool, { movieId = null, seriesId = null }) {
  const col = movieId != null ? 'movie_id' : 'series_id';
  const id = movieId != null ? movieId : seriesId;
  const { rows } = await pool.query(
    `SELECT ts.id, ts.provider_name, ts.format, ts.url, ts.quality, ts.priority
     FROM title_sources ts
     LEFT JOIN providers p ON p.name = ts.provider_key
     WHERE ts.${col} = $1 AND ts.source_type = 'public_domain'
       AND ts.is_playable = true AND ts.enabled = true
       AND ts.status = 'ok' AND ts.stream_validated = true
       AND (ts.provider_key IS NULL OR p.enabled = true)
     ORDER BY ts.priority ASC, ts.id ASC`,
    [id],
  );
  return rows;
}

module.exports = { getSources, getPlayableSources, deriveFormatFromUrl };
