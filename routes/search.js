const express = require('express');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/search?q=&genre=&year=&min_rating=
// Searches movie title, cast/actors, genre and language server-side.
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ data: [] });
    const pool = req.app.locals.pool;
    const params = [`%${q}%`];
    const where = [
      `(title ILIKE $1 OR language ILIKE $1
        OR EXISTS (SELECT 1 FROM unnest("cast") c WHERE c ILIKE $1)
        OR EXISTS (SELECT 1 FROM unnest(genres) g WHERE g ILIKE $1))`,
    ];
    if (req.query.genre) {
      params.push(req.query.genre);
      where.push(`$${params.length} = ANY(genres)`);
    }
    if (req.query.year) {
      params.push(parseInt(req.query.year, 10));
      where.push(`release_year = $${params.length}`);
    }
    if (req.query.min_rating) {
      params.push(parseFloat(req.query.min_rating));
      where.push(`imdb_rating >= $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT id, title, overview, release_year, imdb_rating,
        duration_minutes, language, poster_url, backdrop_url, trailer_url,
        genres, "cast", is_featured, is_premium, NULL AS stream_url
       FROM movies WHERE is_published = true AND ${where.join(' AND ')}
       ORDER BY popularity DESC NULLS LAST LIMIT 50`,
      params,
    );
    res.json({ data: rows });
  } catch (e) { next(e); }
});

module.exports = router;
