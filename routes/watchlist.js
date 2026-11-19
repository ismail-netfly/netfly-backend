const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/watchlist
router.get('/', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `SELECT m.id, m.title, m.overview, m.release_year, m.imdb_rating,
        m.duration_minutes, m.language, m.poster_url, m.backdrop_url,
        m.trailer_url, m.genres, m."cast", m.is_featured, m.is_premium
       FROM watchlist w JOIN movies m ON m.id = w.movie_id
       WHERE w.user_id = $1 ORDER BY w.created_at DESC`,
      [req.user.id],
    );
    res.json({ data: rows });
  } catch (e) { next(e); }
});

// POST /api/watchlist { movie_id }
router.post('/', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query(
      'INSERT INTO watchlist (user_id, movie_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.user.id, req.body.movie_id],
    );
    res.status(201).json({ message: 'Added to watchlist' });
  } catch (e) { next(e); }
});

// DELETE /api/watchlist/:movieId
router.delete('/:movieId', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query(
      'DELETE FROM watchlist WHERE user_id=$1 AND movie_id=$2',
      [req.user.id, req.params.movieId],
    );
    res.json({ message: 'Removed from watchlist' });
  } catch (e) { next(e); }
});

module.exports = router;
