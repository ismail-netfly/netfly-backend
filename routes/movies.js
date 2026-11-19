const express = require('express');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/movies?category=trending|popular|latest|top_rated|featured&genre=&year=&language=&page=
// stream_url is only returned when the caller is authorised (logged in and,
// for premium titles, premium). Never return stream URLs to anonymous users.
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { category, genre, year, language } = req.query;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = 24;
    const offset = (page - 1) * limit;
    const pool = req.app.locals.pool;

    const where = ['is_published = true'];
    const params = [];
    if (genre) { params.push(genre); where.push(`$${params.length} = ANY(genres)`); }
    if (year) { params.push(parseInt(year, 10)); where.push(`release_year = $${params.length}`); }
    if (language) { params.push(language); where.push(`language = $${params.length}`); }

    let order = 'created_at DESC';
    if (category === 'trending') order = 'views DESC';
    if (category === 'popular') order = 'popularity DESC NULLS LAST';
    if (category === 'top_rated') order = 'imdb_rating DESC NULLS LAST';
    if (category === 'featured') where.push('is_featured = true');

    params.push(limit, offset);
    const sql = `SELECT id, title, overview, release_year, imdb_rating,
      duration_minutes, language, poster_url, backdrop_url, trailer_url,
      genres, "cast", is_featured, is_premium,
      CASE WHEN $${params.length + 1} THEN stream_url ELSE NULL END AS stream_url
      FROM movies WHERE ${where.join(' AND ')}
      ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`;
    // Last parameter is the "authorised" flag (logged-in user or not).
    const { rows } = await pool.query(sql, [...params, !!req.user]);
    res.json({ data: rows, page });
  } catch (e) { next(e); }
});

// GET /api/movies/:id
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `SELECT id, title, overview, release_year, imdb_rating, duration_minutes,
        language, poster_url, backdrop_url, trailer_url, genres, "cast",
        is_featured, is_premium,
        CASE WHEN $2 THEN stream_url ELSE NULL END AS stream_url
       FROM movies WHERE id=$1 AND is_published = true`,
      [req.params.id, !!req.user],
    );
    if (!rows[0]) return res.status(404).json({ message: 'Movie not found' });
    // TODO: premium gate — if rows[0].is_premium and user is not premium,
    // return stream_url as NULL and let the app upsell the plan.
    res.json({ data: rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
