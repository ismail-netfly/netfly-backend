const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// POST /api/history/progress
// { content_id, content_type: 'movie'|'episode', progress_seconds, duration_seconds }
router.post('/progress', async (req, res, next) => {
  try {
    const { content_id, content_type, progress_seconds, duration_seconds } = req.body || {};
    if (!content_id || !['movie', 'episode'].includes(content_type)) {
      return res.status(400).json({ message: 'content_id and valid content_type required' });
    }
    const pool = req.app.locals.pool;
    await pool.query(
      `INSERT INTO watch_history (user_id, content_id, content_type, progress_seconds, duration_seconds)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, content_id, content_type)
       DO UPDATE SET progress_seconds = EXCLUDED.progress_seconds,
                     duration_seconds = EXCLUDED.duration_seconds,
                     updated_at = NOW()`,
      [req.user.id, content_id, content_type, progress_seconds || 0, duration_seconds || 0],
    );
    res.json({ message: 'Progress saved' });
  } catch (e) { next(e); }
});

// GET /api/history/continue — Continue Watching (unfinished items first)
router.get('/continue', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `SELECT h.content_id, h.content_type, h.progress_seconds, h.duration_seconds,
        COALESCE(m.title, e.title) AS title,
        COALESCE(m.poster_url, s.poster_url) AS poster_url
       FROM watch_history h
       LEFT JOIN movies m ON h.content_type='movie' AND m.id = h.content_id
       LEFT JOIN episodes e ON h.content_type='episode' AND e.id = h.content_id
       LEFT JOIN seasons se ON e.season_id = se.id
       LEFT JOIN series s ON se.series_id = s.id
       WHERE h.user_id=$1 AND h.progress_seconds < h.duration_seconds * 0.95
       ORDER BY h.updated_at DESC LIMIT 20`,
      [req.user.id],
    );
    res.json({ data: rows });
  } catch (e) { next(e); }
});

// POST /api/history/watched/:episodeId — mark an episode watched
router.post('/watched/:episodeId', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query(
      `INSERT INTO watch_history (user_id, content_id, content_type, progress_seconds, duration_seconds)
       VALUES ($1,$2,'episode',0,0)
       ON CONFLICT (user_id, content_id, content_type) DO NOTHING`,
      [req.user.id, req.params.episodeId],
    );
    res.json({ message: 'Episode marked watched' });
  } catch (e) { next(e); }
});

module.exports = router;
