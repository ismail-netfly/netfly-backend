const express = require('express');
const { optionalAuth } = require('../middleware/auth');
const { getPlayableSources } = require('./sourceHelpers');

const router = express.Router();

// GET /api/titles/:id/sources — playable direct streams for a movie,
// ordered by priority ASC. A title is playable iff this list is
// non-empty. Playable streams are only returned to authorised (logged-in)
// callers, mirroring the stream_url gating in routes/movies.js —
// anonymous callers get an empty list. Broken / disabled sources are
// never returned. Each item: id, provider_name, format, url, quality,
// priority.
router.get('/:id/sources', optionalAuth, async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'SELECT id FROM movies WHERE id=$1 AND is_published = true',
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ message: 'Movie not found' });
    if (!req.user) return res.json({ data: [] });
    const sources = await getPlayableSources(pool, { movieId: req.params.id });
    res.json({ data: sources });
  } catch (e) { next(e); }
});

module.exports = router;
