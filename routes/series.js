const express = require('express');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/series?category=popular|latest&page=
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = 24;
    const offset = (page - 1) * limit;
    const pool = req.app.locals.pool;
    const order = req.query.category === 'latest'
      ? 'created_at DESC'
      : 'popularity DESC NULLS LAST';
    const { rows } = await pool.query(
      `SELECT id, title, overview, release_year, imdb_rating, language,
        poster_url, backdrop_url, trailer_url, genres, is_featured
       FROM series WHERE is_published = true
       ORDER BY ${order} LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    res.json({ data: rows, page });
  } catch (e) { next(e); }
});

// GET /api/series/:id — with seasons + episodes (stream URLs gated).
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'SELECT * FROM series WHERE id=$1 AND is_published = true',
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ message: 'Series not found' });
    const series = rows[0];
    const seasonsRes = await pool.query(
      'SELECT * FROM seasons WHERE series_id=$1 ORDER BY season_number',
      [series.id],
    );
    const seasons = [];
    for (const s of seasonsRes.rows) {
      const eps = await pool.query(
        `SELECT id, season_id, episode_number, title, overview,
          duration_minutes, thumbnail_url,
          CASE WHEN $2 THEN stream_url ELSE NULL END AS stream_url
         FROM episodes WHERE season_id=$1 ORDER BY episode_number`,
        [s.id, !!req.user],
      );
      seasons.push({ ...s, episodes: eps.rows });
    }
    res.json({ data: { ...series, seasons } });
  } catch (e) { next(e); }
});

module.exports = router;
