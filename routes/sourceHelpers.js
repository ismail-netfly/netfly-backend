// Shared helper: sources attached to a title, with the same gating rule
// as stream_url — playable direct streams are only returned to authorised
// (logged-in) callers. Trailers and provider link-outs are public, and
// sources flagged 'broken' by the checker are never shown to the app
// (the admin panel still lists them via /api/admin/sources?status=broken).
async function getSources(pool, { movieId = null, seriesId = null }, authed) {
  const col = movieId != null ? 'movie_id' : 'series_id';
  const id = movieId != null ? movieId : seriesId;
  const { rows } = await pool.query(
    `SELECT id, source_type, provider_name, provider_id, provider_logo_path,
            offer_type, url, language, quality, region, is_playable, status
     FROM title_sources
     WHERE ${col} = $1 AND status != 'broken' AND ($2 OR NOT is_playable)
     ORDER BY source_type, provider_name`,
    [id, !!authed],
  );
  return rows;
}

module.exports = { getSources };
